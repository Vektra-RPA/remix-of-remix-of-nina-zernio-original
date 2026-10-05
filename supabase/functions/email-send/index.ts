import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserFromToken } from "../_shared/auth.ts";

// Envio de e-mail da Lis via Resend. Porte do pipeline Python (src/pipeline/enviar.py),
// adaptado para edge function (stateless) + Supabase + Resend (em vez de Gmail SMTP).
//
// O que veio do enviar.py: rate limit em janela, retry com backoff só para falha
// transitória, threading por In-Reply-To/References, corpo multipart (texto + HTML),
// envio prioritário (resposta de lead fura a fila), rodapé de descadastro e registro
// em `messages`. O circuit breaker do Gmail não foi portado de propósito: o Resend é
// API key via HTTPS, sem bloqueio de conta por tentativas de login — 401/403 aqui é
// chave inválida, tratada como erro não-retentável e com mensagem clara.
//
// Rate limit vem do banco (não de estado em memória): a edge function é stateless e
// pode rodar concorrente (cron da cadência + chamada manual). A contagem em `messages`
// é a fonte durável e compartilhada — mesma decisão do _RATE_USA_BANCO do Python.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const RESEND_API = 'https://api.resend.com/emails';
const RATE_MAX_HOUR = Number(Deno.env.get('EMAIL_RATE_MAX_HOUR') ?? '15');
const RATE_MAX_MINUTE = Number(Deno.env.get('EMAIL_RATE_MAX_MINUTE') ?? '3');
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 2_000;
const DEFAULT_UNSUBSCRIBE = 'Para não receber mais mensagens, responda "parar".';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

type EmailConfig = {
  apiKey: string;
  from: string;      // "Nome <email@dominio>"
  fromEmail: string;
  replyTo: string | null;
  unsubscribe: string;
};

function emailConfigOrNull(): EmailConfig | null {
  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  const fromEmail = (Deno.env.get('EMAIL_FROM') || '').trim();
  if (!apiKey || !fromEmail) return null;
  const fromName = (Deno.env.get('EMAIL_FROM_NAME') || 'Lis - Trajetória Consultoria').trim();
  return {
    apiKey,
    from: `${fromName} <${fromEmail}>`,
    fromEmail,
    replyTo: (Deno.env.get('EMAIL_REPLY_TO') || '').trim() || null,
    unsubscribe: (Deno.env.get('EMAIL_UNSUBSCRIBE_TEXT') || DEFAULT_UNSUBSCRIBE).trim(),
  };
}

async function authenticate(req: Request, supabase: SupabaseClient) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  // Chamada interna (worker de cadência) usa a service role.
  if (serviceKey && token === serviceKey) return { internal: true, isAdmin: true };
  const { data, error } = await getUserFromToken(token);
  if (error || !data?.user) return null;
  const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: data.user.id, _role: 'admin' });
  return { internal: false, isAdmin: !!isAdmin };
}

function isTransient(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

type SendArgs = { to: string; subject: string; text: string; html?: string | null; headers?: Record<string, string> };

async function sendViaResend(cfg: EmailConfig, args: SendArgs): Promise<{ ok: boolean; id: string | null; status: number; error: string | null }> {
  let lastError = '';
  let lastStatus = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(RESEND_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: cfg.from,
          to: [args.to],
          subject: args.subject,
          text: args.text,
          ...(args.html ? { html: args.html } : {}),
          ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
          ...(args.headers && Object.keys(args.headers).length ? { headers: args.headers } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      // Rede/timeout: transitório, retenta.
      lastError = error instanceof Error ? error.message : String(error);
      lastStatus = 0;
      if (attempt < MAX_RETRIES) { await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * (2 ** attempt))); continue; }
      break;
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, id: (data as { id?: string })?.id ?? null, status: response.status, error: null };
    lastStatus = response.status;
    lastError = (data as { message?: string; name?: string })?.message
      || (data as { name?: string })?.name
      || `Resend respondeu ${response.status}`;
    // 401/403 (chave inválida) e 422 (validação) não se resolvem com retry.
    if (response.status === 401 || response.status === 403 || response.status === 422) break;
    if (!isTransient(response.status)) break;
    if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * (2 ** attempt)));
  }
  return { ok: false, id: null, status: lastStatus, error: lastError || 'Falha ao enviar e-mail' };
}

/** Conta e-mails enviados pela Lis na janela (fonte: tabela messages, metadata.channel='email'). */
async function emailsSentSince(supabase: SupabaseClient, sinceIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('from_type', 'nina')
    .filter('metadata->>channel', 'eq', 'email')
    .gt('sent_at', sinceIso);
  if (error) {
    console.error('[email-send] contagem de rate limit falhou', error.message ?? error);
    return 0; // leitura falha nunca bloqueia envio (igual ao Python)
  }
  return count ?? 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const auth = await authenticate(req, supabase);
    if (!auth || !auth.isAdmin) return json({ error: 'Não autorizado' }, 401);

    const cfg = emailConfigOrNull();
    if (!cfg) {
      return json({ error: 'E-mail não configurado no servidor. Defina RESEND_API_KEY e EMAIL_FROM.', code: 'email_not_configured' }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const internal = body.internal === true;
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const text = typeof body.text === 'string' ? body.text : '';
    const html = typeof body.html === 'string' && body.html ? body.html : null;
    if (!subject || !text) return json({ error: 'Informe subject e text.' }, 400);

    // ===== Modo interno: notificação para o time (ficha, alerta, escalada) =====
    // Não leva rodapé de descadastro, não entra no rate limit e não é registrado
    // em messages — não é comunicação com lead (igual ao enviar_email_interno do Python).
    if (internal) {
      const recipients: string[] = Array.isArray(body.to)
        ? body.to.filter((x: unknown) => typeof x === 'string' && x.includes('@'))
        : (typeof body.to === 'string' && body.to.includes('@') ? [body.to] : []);
      if (recipients.length === 0) return json({ error: 'Informe ao menos um destinatário interno.' }, 400);
      const results: Array<{ to: string; ok: boolean; id: string | null; error: string | null }> = [];
      for (const to of recipients) {
        const r = await sendViaResend(cfg, { to, subject, text, html });
        results.push({ to, ok: r.ok, id: r.id, error: r.error });
      }
      const okAll = results.every((r) => r.ok);
      return json({ ok: okAll, internal: true, results }, okAll ? 200 : 502);
    }

    // ===== E-mail para lead =====
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!to || !to.includes('@')) return json({ error: 'Informe o e-mail do destinatário (to).' }, 400);
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
    if (!conversationId) return json({ error: 'Informe o conversationId (o e-mail pertence a uma conversa do lead).' }, 400);
    const inReplyTo = typeof body.inReplyTo === 'string' && body.inReplyTo ? body.inReplyTo : null;
    const references = typeof body.references === 'string' && body.references ? body.references : null;
    const priority = body.priority === true; // resposta a lead fura o rate limit

    // Rate limit (só para não-prioritário), contado no banco. Prioritário ainda
    // ocupa um slot (conta depois do INSERT), mas não espera — como no Python.
    if (!priority) {
      const now = Date.now();
      const perHour = await emailsSentSince(supabase, new Date(now - 3_600_000).toISOString());
      if (perHour >= RATE_MAX_HOUR) {
        return json({ error: `Rate limit atingido (${RATE_MAX_HOUR}/h). Tente no próximo ciclo.`, code: 'rate_limited', scope: 'hour' }, 429);
      }
      const perMinute = await emailsSentSince(supabase, new Date(now - 60_000).toISOString());
      if (perMinute >= RATE_MAX_MINUTE) {
        return json({ error: `Rate limit atingido (${RATE_MAX_MINUTE}/min). Tente no próximo ciclo.`, code: 'rate_limited', scope: 'minute' }, 429);
      }
    }

    // Rodapé de descadastro (playbook 3.2) — anexado se ainda não estiver no corpo.
    const unsub = cfg.unsubscribe;
    const finalText = text.includes(unsub) ? text : `${text}\n\n—\n${unsub}`;
    const finalHtml = html
      ? (html.includes(unsub) ? html : `${html}\n<p style="color:#8a94a6;font-size:12px">—<br>${escapeHtml(unsub)}</p>`)
      : null;

    // Threading: mantém o fio do e-mail (mesma thread que o lead respondeu).
    const headers: Record<string, string> = {};
    if (inReplyTo) {
      headers['In-Reply-To'] = inReplyTo;
      headers['References'] = references ? `${references} ${inReplyTo}`.trim() : inReplyTo;
    }

    const result = await sendViaResend(cfg, { to, subject, text: finalText, html: finalHtml, headers });
    if (!result.ok) {
      return json({ error: result.error, code: result.status === 401 || result.status === 403 ? 'auth' : 'send_failed', providerStatus: result.status }, 502);
    }

    // Registra o envio em messages — alimenta o histórico, o rate limit e o threading.
    // DB falho aqui não "desenvia" o e-mail (ele já saiu); apenas loga o erro.
    const { data: inserted, error: insertError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        from_type: 'nina',
        type: 'text',
        status: 'sent',
        content: finalText,
        sent_at: new Date().toISOString(),
        metadata: {
          channel: 'email',
          to,
          subject,
          resend_id: result.id,
          in_reply_to: inReplyTo,
          references,
          priority,
        },
      })
      .select('id')
      .maybeSingle();
    if (insertError) console.error('[email-send] registro em messages falhou', insertError.message ?? insertError);

    return json({ ok: true, id: result.id, messageId: (inserted as { id?: string } | null)?.id ?? null });
  } catch (error) {
    console.error('[email-send] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Erro interno' }, 500);
  }
});
