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
async function handleInboundReply(supabase: SupabaseClient, inbound: Inbound): Promise<Response> {
  const email = inbound.from!;
  const contact = await findContactByEmail(supabase, email);
  if (!contact) {
    // Remetente desconhecido: não cria lead a partir de um reply solto; só registra.
    console.log('[email-inbound] reply de remetente sem contato:', email);
    return json({ ok: true, ignored: 'contato não encontrado', email });
  }

  // Conversa de e-mail do contato (reaproveita a ativa; senão cria channel='email').
  let { data: conversation } = await supabase
    .from('conversations')
    .select('id, status, metadata')
    .eq('contact_id', contact.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!conversation) {
    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ contact_id: contact.id, channel: 'email', status: 'human', is_active: true })
      .select('id, status, metadata')
      .single();
    if (error) return json({ error: `falha ao criar conversa: ${error.message}` }, 500);
    conversation = created;
  }

  // Registra a mensagem recebida.
  const { error: msgError } = await supabase.from('messages').insert({
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
  });
  if (msgError) console.error('[email-inbound] registro da mensagem falhou', msgError.message ?? msgError);

  // Regra dura do playbook: qualquer resposta pausa a automação. A conversa vai para
  // atendimento humano porque a Lis ainda não responde por e-mail automaticamente
  // (fila do orquestrador é WhatsApp; channel-aware é o próximo wiring).
  await supabase.from('conversations').update({
    status: 'human',
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

  return json({ ok: true, contact_id: contact.id, conversation_id: conversation.id, paused_cadence: true, status: 'human' });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';
  const url = new URL(req.url);
  const provided = url.searchParams.get('secret') || req.headers.get('x-webhook-secret') || '';
  if (!secret || provided !== secret) return json({ error: 'Não autorizado' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = record(await req.json().catch(() => ({})));

    // Evento de entrega/bounce/complaint do Resend.
    const eventType = typeof body.type === 'string' ? body.type : '';
    if (eventType.startsWith('email.')) {
      return await handleEvent(supabase, eventType, record(body.data));
    }

    // Caso contrário, tratamos como e-mail recebido (resposta de lead).
    const inbound = extractInbound(body);
    if (!inbound.from) return json({ error: 'Payload não reconhecido (sem remetente).' }, 422);
    return await handleInboundReply(supabase, inbound);
  } catch (error) {
    console.error('[email-inbound] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Erro interno' }, 500);
  }
});
