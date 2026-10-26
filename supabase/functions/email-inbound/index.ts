import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Recebimento de e-mail da Lis. Equivalente ao src/pipeline/receber.py (IMAP) do
// Python, mas como WEBHOOK: o provedor de inbound (Resend inbound, ou um forwarder
// tipo Cloudflare Email Routing) faz POST aqui com a resposta do lead; eventos de
// entrega/bounce do Resend também chegam aqui.
//
// Regras do playbook aplicadas:
// - QUALQUER resposta do lead pausa a automação (cancela a cadência pendente) e a
//   conversa vai para atendimento (status 'human') — o auto-reply por e-mail da Lis
//   depende de a fila do orquestrador virar channel-aware (wiring seguinte).
// - Bounce remove o contato do e-mail; complaint (spam) vira opt-out.
//
// Segurança: valida um segredo compartilhado (?secret= ou header x-webhook-secret)
// contra RESEND_WEBHOOK_SECRET. (A verificação de assinatura svix do Resend pode ser
// adicionada depois como endurecimento.)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Extrai um endereço de e-mail de string ("Nome <a@b>"), objeto ({email}) ou array. */
function extractEmail(value: unknown): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) { const e = extractEmail(item); if (e) return e; }
    return null;
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return extractEmail(rec.email ?? rec.address ?? rec.value);
  }
  const match = String(value).match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

// ===== Verificação de assinatura svix (Resend assina os webhooks com svix) =====
// Mantém o segredo compartilhado (?secret=/header) como fallback para forwarders
// que não assinam (ex.: Cloudflare Email Routing). Com RESEND_WEBHOOK_SECRET no
// formato whsec_... e os headers svix presentes, a assinatura é verificada.

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySvix(secret: string, headers: Headers, rawBody: string): Promise<boolean> {
  try {
    const id = headers.get('svix-id');
    const ts = headers.get('svix-timestamp');
    const sigHeader = headers.get('svix-signature');
    if (!id || !ts || !sigHeader) return false;
    // Tolerância de 5 min no timestamp (anti-replay), como o SDK do svix.
    const tsNum = Number(ts);
    if (Number.isFinite(tsNum) && Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
    const secretB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const key = await crypto.subtle.importKey(
      'raw', base64ToBytes(secretB64) as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const signed = new TextEncoder().encode(`${id}.${ts}.${rawBody}`) as unknown as BufferSource;
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));
    const expected = bytesToBase64(mac);
    // Header: "v1,<b64> v1,<b64> ..." — aceita se qualquer assinatura casar.
    const provided = sigHeader.split(' ').map((p) => (p.includes(',') ? p.split(',')[1] : p));
    return provided.some((p) => timingSafeEqualStr(p, expected));
  } catch (e) {
    console.error('[email-inbound] verificação svix falhou', e);
    return false;
  }
}

/**
 * Detecta auto-resposta de ausência (OOO) para a Lis não entrar em robô-com-robô:
 * um "estou de férias" não é resposta do lead — não pausa a cadência nem vira
 * atendimento. Sinais: cabeçalhos Auto-Submitted/X-Autoreply/Precedence e assunto.
 */
function isAutoReply(body: Record<string, unknown>, subject: string | null): boolean {
  const data = record(body.data);
  const src = Object.keys(data).length ? data : body;
  const headers = record(src.headers);
  const h = (k: string) => String(headers[k] ?? headers[k.toLowerCase()] ?? '').toLowerCase().trim();
  const autoSubmitted = h('auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (h('x-autoreply') || h('x-autorespond') || h('x-auto-response-suppress')) return true;
  if (h('precedence') === 'auto_reply') return true;
  const subj = (subject ?? '').toLowerCase();
  return /out of office|automatic reply|auto.?reply|automatic response|aus[êe]ncia|ausente|resposta autom|fora do escrit|de f[ée]rias|on vacation|away from (my )?(desk|office)|afastad/.test(subj);
}

type Inbound = {
  from: string | null;
  subject: string | null;
  text: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
};

/** Normaliza o payload de inbound aceitando formas comuns (Resend inbound / forwarder). */
function extractInbound(body: Record<string, unknown>): Inbound {
  const data = record(body.data);
  const src = Object.keys(data).length ? data : body;
  const headers = record(src.headers);
  const from = extractEmail(src.from ?? src.sender ?? src.From ?? headers.from);
  const subject = firstString(src.subject, src.Subject, headers.subject);
  const text = firstString(src.text, (src as Record<string, unknown>)['text/plain'], src.plain, src.body, src.stripped_text);
  const messageId = firstString(headers['message-id'], (src as Record<string, unknown>)['message_id'], src.messageId);
  const inReplyTo = firstString(headers['in-reply-to'], (src as Record<string, unknown>)['in_reply_to']);
  const references = firstString(headers['references']);
  return { from, subject, text, messageId, inReplyTo, references };
}

const CONTACT_COLS = 'id, email, phone_number, name, tags, client_memory';

async function findContactByEmail(supabase: SupabaseClient, email: string) {
  const { data } = await supabase.from('contacts').select(CONTACT_COLS).ilike('email', email).limit(1);
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

/** Cancela a cadência pendente do contato. Tolerante: a tabela pode ainda não existir (Épico C). */
async function cancelarCadencia(supabase: SupabaseClient, contactId: string): Promise<void> {
  const { error } = await supabase
    .from('cadence_state')
    .update({ status: 'cancelled' })
    .eq('contact_id', contactId)
    .eq('status', 'pending');
  if (error && error.code !== '42P01') {
    console.error('[email-inbound] cancelar cadência falhou', error.message ?? error);
  }
}

/** Bounce/complaint do Resend: remove do e-mail (bounce) ou opt-out (complaint). */
async function handleEvent(supabase: SupabaseClient, type: string, data: Record<string, unknown>): Promise<Response> {
  const email = extractEmail(data.to ?? data.email ?? data.recipient);
  if (!email) return json({ ok: true, ignored: 'evento sem destinatário' });
  const contact = await findContactByEmail(supabase, email);
  if (!contact) return json({ ok: true, ignored: 'contato não encontrado', email });

  const now = new Date().toISOString();
  const memory = record(contact.client_memory);
  const currentTags: string[] = Array.isArray(contact.tags) ? contact.tags : [];
  const isComplaint = type === 'email.complained';
  const isBounce = type === 'email.bounced';
  if (!isComplaint && !isBounce) return json({ ok: true, ignored: type }); // delivered/opened/clicked: nada a fazer

  const tag = isComplaint ? 'opt_out' : 'bounce';
  await supabase.from('contacts').update({
    tags: Array.from(new Set([...currentTags, tag])),
    client_memory: {
      ...memory,
      ...(isComplaint ? { opt_out: true, opt_out_at: now, opt_out_reason: 'reclamação de spam (complaint)' } : {}),
      ...(isBounce ? { email_bounced_at: now, email_reachable: false } : {}),
    },
  }).eq('id', contact.id);
  await cancelarCadencia(supabase, contact.id);
  return json({ ok: true, event: type, contact_id: contact.id, email });
}

/** Resposta de lead: captura, pausa a cadência e manda para atendimento (status 'human'). */
/**
 * Resend Receiving: o evento `email.received` traz só os metadados (remetente,
 * assunto, id). O texto vem da API de e-mails recebidos — precisa de chave com
 * acesso total; sem ela, segue só com os metadados (a cadência pausa do mesmo jeito).
 */
async function inboundFromResendEvent(data: Record<string, unknown>): Promise<Inbound> {
  const base = extractInbound(data);
  if (base.text) return base;
  const id = typeof data.email_id === 'string' ? data.email_id : typeof data.id === 'string' ? data.id : '';
  const key = Deno.env.get('RESEND_API_KEY');
  if (!id || !key) return base;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error('[email-inbound] corpo do e-mail recebido indisponível', res.status, (await res.text()).slice(0, 200));
      return base;
    }
    const full = extractInbound(record(await res.json()));
    return {
      from: base.from ?? full.from,
      subject: base.subject ?? full.subject,
      text: full.text,
      messageId: base.messageId ?? full.messageId,
      inReplyTo: base.inReplyTo ?? full.inReplyTo,
      references: base.references ?? full.references,
    };
  } catch (error) {
    console.error('[email-inbound] falha ao buscar o e-mail recebido', error);
    return base;
  }
}

async function handleInboundReply(supabase: SupabaseClient, inbound: Inbound): Promise<Response> {
  const email = inbound.from!;
  const contact = await findContactByEmail(supabase, email);
  if (!contact) {
    // Remetente desconhecido: não cria lead a partir de um reply solto; só registra.
    console.log('[email-inbound] reply de remetente sem contato:', email);
    return json({ ok: true, ignored: 'contato não encontrado', email });
  }

  // Conversa de e-mail do contato (channel='email' — separada de uma eventual de
  // WhatsApp — para a Lis responder pelo canal certo).
  let { data: conversation } = await supabase
    .from('conversations')
    .select('id, status, metadata')
    .eq('contact_id', contact.id)
    .eq('channel', 'email')
    .eq('is_active', true)
    .maybeSingle();
  if (!conversation) {
    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ contact_id: contact.id, channel: 'email', status: 'nina', is_active: true })
      .select('id, status, metadata')
      .single();
    if (error) return json({ error: `falha ao criar conversa: ${error.message}` }, 500);
    conversation = created;
  }

  // Registra a mensagem recebida.
  const { data: inserted, error: msgError } = await supabase.from('messages').insert({
    conversation_id: conversation.id,
    from_type: 'user',
    type: 'text',
    status: 'sent',
    content: inbound.text ?? '[e-mail sem corpo de texto]',
    sent_at: new Date().toISOString(),
    metadata: {
      channel: 'email',
      from: email,
      subject: inbound.subject,
      message_id: inbound.messageId,
      in_reply_to: inbound.inReplyTo,
      references: inbound.references,
    },
  }).select('id').maybeSingle();
  if (msgError) console.error('[email-inbound] registro da mensagem falhou', msgError.message ?? msgError);

  // Regra dura do playbook: qualquer resposta pausa a automação (cancela a cadência).
  // A conversa segue com a Nina, que responde por e-mail (orquestrador channel-aware).
  // Sem o texto da resposta a Lis responderia às cegas: pausa e passa para uma pessoa.
  const hasBody = !!inbound.text;
  await supabase.from('conversations').update({
    status: hasBody ? 'nina' : 'human',
    is_active: true,
    last_message_at: new Date().toISOString(),
    metadata: { ...record(conversation.metadata), last_email_subject: inbound.subject, last_email_message_id: inbound.messageId },
  }).eq('id', conversation.id);

  const memory = record(contact.client_memory);
  const currentTags: string[] = Array.isArray(contact.tags) ? contact.tags : [];
  await supabase.from('contacts').update({
    tags: Array.from(new Set([...currentTags, 'replied'])),
    client_memory: { ...memory, replied_at: new Date().toISOString(), last_reply_channel: 'email' },
    last_activity: new Date().toISOString(),
  }).eq('id', contact.id);

  await cancelarCadencia(supabase, contact.id);

  // Encaminha para a Nina processar e responder por e-mail (mesma fila do WhatsApp).
  const messageId = (inserted as { id?: string } | null)?.id ?? null;
  if (messageId && hasBody) {
    await supabase.from('nina_processing_queue').insert({
      message_id: messageId,
      conversation_id: conversation.id,
      contact_id: contact.id,
      priority: 1,
      context_data: { channel: 'email', subject: inbound.subject },
    });
    const trigger = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/nina-orchestrator`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggered_by: 'email-inbound' }),
    }).catch((e) => console.error('[email-inbound] trigger do orquestrador falhou', e));
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(trigger);
  }

  return json({ ok: true, contact_id: contact.id, conversation_id: conversation.id, paused_cadence: true, status: hasBody ? 'nina' : 'human', queued: !!messageId && hasBody });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  // Corpo cru primeiro: a verificação svix assina o texto exato recebido.
  const rawBody = await req.text();

  // Autorização: assinatura svix (Resend) quando configurada; senão, segredo
  // compartilhado (?secret=/header) para forwarders que não assinam.
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';
  if (!secret) return json({ error: 'Webhook não configurado (RESEND_WEBHOOK_SECRET ausente).' }, 401);
  const hasSvix = !!req.headers.get('svix-id') && !!req.headers.get('svix-signature');
  let authorized = false;
  if (hasSvix && secret.startsWith('whsec_')) {
    authorized = await verifySvix(secret, req.headers, rawBody);
  } else {
    const url = new URL(req.url);
    const provided = url.searchParams.get('secret') || req.headers.get('x-webhook-secret') || '';
    authorized = provided === secret;
  }
  if (!authorized) return json({ error: 'Não autorizado' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    let parsed: unknown = {};
    try { parsed = rawBody ? JSON.parse(rawBody) : {}; } catch { parsed = {}; }
    const body = record(parsed);

    // Evento de entrega/bounce/complaint do Resend.
    const eventType = typeof body.type === 'string' ? body.type : '';
    if (eventType === 'email.received') {
      const received = await inboundFromResendEvent(record(body.data));
      if (!received.from) return json({ ok: true, ignored: 'email.received sem remetente' });
      if (isAutoReply(record(body.data), received.subject)) {
        console.log('[email-inbound] auto-resposta (OOO) ignorada:', received.from, '—', received.subject);
        return json({ ok: true, ignored: 'auto-reply (OOO)', from: received.from });
      }
      return await handleInboundReply(supabase, received);
    }
    if (eventType.startsWith('email.')) {
      return await handleEvent(supabase, eventType, record(body.data));
    }

    // Caso contrário, tratamos como e-mail recebido (resposta de lead).
    const inbound = extractInbound(body);
    if (!inbound.from) return json({ error: 'Payload não reconhecido (sem remetente).' }, 422);

    // Auto-resposta de ausência (OOO): não é resposta do lead. Registra e ignora
    // sem pausar a cadência nem acionar a Lis (evita robô-com-robô).
    if (isAutoReply(body, inbound.subject)) {
      console.log('[email-inbound] auto-resposta (OOO) ignorada:', inbound.from, '—', inbound.subject);
      return json({ ok: true, ignored: 'auto-reply (OOO)', from: inbound.from });
    }

    return await handleInboundReply(supabase, inbound);
  } catch (error) {
    console.error('[email-inbound] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Erro interno' }, 500);
  }
});
