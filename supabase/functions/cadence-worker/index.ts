import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserFromToken } from "../_shared/auth.ts";
import {
  CADENCE_STEPS,
  ENABLED_STEPS,
  renderCadenceEmail,
  waTemplateBody,
  type CadencePersona,
} from "../_shared/cadence-templates.ts";
import { isExcludedEmail, isGenericEmail } from "../_shared/exclusions.ts";
import { enqueueTemplateForContact, enqueueTemplateWithMessage } from "../_shared/template-dispatch.ts";
import { authenticateCronRequest } from "../_shared/cron-auth.ts";

// Motor de cadência (porte do src/pipeline/cadencia.py da Lis Python) para edge function.
// Diferença de arquitetura: o Python roda um worker long-running (loop 30s); aqui é UMA
// passada por invocação, disparada por cron. O estado de cada step vive em cadence_state.
//
// Regras portadas do cadencia.py: janela útil 9-17h dia útil, claim atômico (pending->
// sending) para não enviar duplicado, guarda de ordem (follow-up nunca antes da abertura),
// reagendamento do próximo step ancorado no envio REAL (espaçamento se mantém após pausas),
// reclaim de órfãos presos em 'sending', cancelamento ao responder / opt-out.
//
// E-mail via a função email-send (que já faz rate limit + retry + descadastro). WhatsApp
// (D3/D9) via template Meta aprovado por persona — ver trySendWhatsapp. Cada toque de
// WhatsApp guarda a mensagem enviada (cadence_state.message_id): o D9 só sai se o D3
// foi entregue, e o toque barrado pela Meta por limite de marketing ganha UMA nova
// tentativa (runWaRetries).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
// deno-lint-ignore no-explicit-any
type Contact = any;

const BATCH = 25;          // steps processados por passada
const ENROLL_PER_RUN = 25; // novos leads matriculados por passada
const ORPHAN_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const OPENING_STEP = CADENCE_STEPS.find((s) => s.offsetDays === 0)?.step ?? 1;
const COMPANY_COOLDOWN_DAYS = 30; // playbook 1.2: a outra persona da empresa só entra 30 dias depois

// Regras de envio do piloto (playbook 3.2 e Passo 4), ajustáveis por env:
// e-mails só de terça a quinta, abertura (D0) só de manhã e no máximo 20–30 por dia por caixa.
function sendWeekdays(): number[] {
  return (Deno.env.get('CADENCE_SEND_WEEKDAYS') || '2,3,4')
    .split(',').map((d) => Number(d.trim())).filter((d) => d >= 0 && d <= 6);
}
const DAILY_EMAIL_MAX = Math.max(1, Number(Deno.env.get('CADENCE_DAILY_EMAIL_MAX') || 25));
const OPENING_END_HOUR = Number(Deno.env.get('CADENCE_OPENING_END_HOUR') || 12);
// WhatsApp (playbook 3.4): volume baixo no piloto, até 20–30 contatos por dia.
const DAILY_WA_MAX = Math.max(1, Number(Deno.env.get('CADENCE_DAILY_WA_MAX') || 25));
// Espalha os toques ao longo da manhã em vez de disparar a cota inteira de uma vez
// (o cron roda a cada 5 min: 5 por passada = 25 em ~25 min).
const WA_PER_PASS = Math.max(1, Number(Deno.env.get('CADENCE_WA_PER_PASS') || 5));
// Steps de WhatsApp obrigatórios: enquanto o template não estiver aprovado na Meta,
// o toque ESPERA (fica pendente e segura os seguintes) em vez de ser pulado.
function waHoldSteps(): number[] {
  return (Deno.env.get('CADENCE_WA_HOLD_STEPS') || '')
    .split(',').map((d) => Number(d.trim())).filter((d) => Number.isInteger(d) && d > 0);
}
// Nova tentativa do toque que a Meta barrou pelo limite de marketing por usuário
// (131049 — "healthy ecosystem engagement"). A Meta orienta não reenviar na hora:
// a cadência tenta UMA vez, pelo menos CADENCE_WA_RETRY_AFTER_HOURS depois, à tarde
// (depois dos envios novos da manhã) e só enquanto o próximo toque ainda não venceu —
// assim a nova tentativa nunca sai depois do e-mail seguinte. Cota diária própria.
const WA_RETRY_CODES = (Deno.env.get('CADENCE_WA_RETRY_CODES') || '131049')
  .split(',').map((c) => Number(c.trim())).filter((c) => Number.isInteger(c) && c > 0);
const WA_MAX_ATTEMPTS = Math.max(1, Number(Deno.env.get('CADENCE_WA_MAX_ATTEMPTS') || 2));
const WA_RETRY_AFTER_MS = Math.max(1, Number(Deno.env.get('CADENCE_WA_RETRY_AFTER_HOURS') || 20)) * 3_600_000;
const WA_RETRY_FROM_HOUR = Number(Deno.env.get('CADENCE_WA_RETRY_FROM_HOUR') || 14);
const DAILY_WA_RETRY_MAX = Math.max(0, Number(Deno.env.get('CADENCE_WA_RETRY_MAX') ?? 30));

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function personaOf(contact: Contact): CadencePersona | null {
  const apollo = record(record(contact.client_memory).apollo);
  const p = apollo.persona;
  if (p === 'P1' || p === 'P3') return p;
  const tags: string[] = Array.isArray(contact.tags) ? contact.tags : [];
  if (tags.includes('P1')) return 'P1';
  if (tags.includes('P3')) return 'P3';
  return null;
}

function isSuppressed(contact: Contact): boolean {
  const tags: string[] = Array.isArray(contact.tags) ? contact.tags : [];
  if (tags.includes('opt_out') || tags.includes('bounce')) return true;
  const mem = record(contact.client_memory);
  return mem.opt_out === true || mem.email_reachable === false;
}

function hasReplied(contact: Contact): boolean {
  const tags: string[] = Array.isArray(contact.tags) ? contact.tags : [];
  if (tags.includes('replied')) return true;
  return !!record(contact.client_memory).replied_at;
}

function renderVars(contact: Contact): { nome: string; empresa: string } {
  const name = typeof contact.call_name === 'string' && contact.call_name.trim()
    ? contact.call_name.trim()
    : (typeof contact.name === 'string' ? contact.name.trim().split(/\s+/)[0] : '');
  const apollo = record(record(contact.client_memory).apollo);
  const leadState = record(record(contact.client_memory).lead_state);
  const empresa = (typeof apollo.company === 'string' && apollo.company)
    || (typeof record(leadState.company).value === 'string' ? String(record(leadState.company).value) : '')
    || 'sua empresa';
  return { nome: name || 'tudo bem', empresa };
}

function ignoreWindow(): boolean {
  return Deno.env.get('CADENCE_IGNORE_WINDOW') === 'true';
}

/** Agora em BRT (UTC-3) — ler com os métodos getUTC*. */
function brNow(): Date {
  return new Date(Date.now() - 3 * 3_600_000);
}

/** Janela útil 9-17h BRT (UTC-3), dia útil. CADENCE_IGNORE_WINDOW=true libera (só ensaio). */
function withinWindow(): boolean {
  if (ignoreWindow()) return true;
  const br = brNow();
  const day = br.getUTCDay(); // 0=domingo, 6=sábado
  if (day === 0 || day === 6) return false;
  const hour = br.getUTCHours();
  return hour >= 9 && hour < 17;
}

/** Dia de envio do piloto (padrão terça a quinta). */
function isSendDay(): boolean {
  return ignoreWindow() || sendWeekdays().includes(brNow().getUTCDay());
}

/** A abertura (D0) sai só de manhã. */
function isOpeningWindow(): boolean {
  return ignoreWindow() || brNow().getUTCHours() < OPENING_END_HOUR;
}

/** Nova tentativa de WhatsApp só à tarde (depois dos envios novos da manhã). */
function isRetryWindow(): boolean {
  return ignoreWindow() || brNow().getUTCHours() >= WA_RETRY_FROM_HOUR;
}

/** Início do dia de hoje em São Paulo, em ISO (UTC). */
function brDayStartIso(): string {
  const br = brNow();
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()) + 3 * 3_600_000).toISOString();
}

/** E-mails da cadência já enviados hoje (dia de São Paulo). */
async function emailsSentToday(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from('cadence_state')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'email')
    .eq('status', 'sent')
    .gte('sent_at', brDayStartIso());
  return count ?? 0;
}

/** Toques de WhatsApp da cadência já enviados hoje (dia de São Paulo). */
async function whatsappSentToday(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from('cadence_state')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'whatsapp')
    .eq('status', 'sent')
    .gte('sent_at', brDayStartIso());
  return count ?? 0;
}

/** Novas tentativas de WhatsApp feitas hoje (não contam na cota de toques novos). */
async function waRetriesToday(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from('cadence_state')
    .select('id', { count: 'exact', head: true })
    .gte('retried_at', brDayStartIso());
  return count ?? 0;
}

/** Nova tentativa de um toque em espera (o worker ainda respeita janela e dias de envio). */
const HOLD_RETRY_MS = 30 * 60_000;
function holdRetryIso(): string {
  return new Date(Date.now() + HOLD_RETRY_MS).toISOString();
}

/** Playbook 1.3: só e-mail "Verified" no Apollo (sem status = não veio do Apollo, passa). */
function emailNotVerified(contact: Contact): boolean {
  const status = record(record(contact.client_memory).apollo).email_status;
  return typeof status === 'string' && status !== '' && status.toLowerCase() !== 'verified';
}

/** Filtros de entrada na campanha que não dependem do banco. */
function notEligible(contact: Contact): boolean {
  return !contact.email || !personaOf(contact) || isSuppressed(contact) || hasReplied(contact)
    || isExcludedEmail(contact.email) // domínio próprio / cliente ativo
    || isGenericEmail(contact.email)   // contato@, comercial@, sac@...
    || emailNotVerified(contact);
}

async function authenticate(req: Request, supabase: SupabaseClient): Promise<boolean> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  if (token === serviceKey) return true; // service role / chamada interna
  // Disparador externo (ex.: GitHub Actions) quando o scheduler do Lovable falha:
  // Bearer = CADENCE_TRIGGER_TOKEN (valor definido pelo time nas secrets). Só vale
  // se o secret estiver setado; dá pra rotacionar a qualquer momento.
  const triggerToken = (Deno.env.get('CADENCE_TRIGGER_TOKEN') || '').trim();
  if (triggerToken && token === triggerToken) return true;
  // Agendamento gerenciado do Lovable Cloud: Bearer = LOVABLE_CRON_SECRET
  // (helper gerado pelo próprio Lovable). Mantém service role e admin abaixo.
  if (authenticateCronRequest(req) === null) return true;
  const { data, error } = await getUserFromToken(token);
  if (error || !data?.user) return false;
  const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: data.user.id, _role: 'admin' });
  return !!isAdmin;
}

async function markStep(supabase: SupabaseClient, id: string, status: string, error: string | null = null): Promise<void> {
  await supabase.from('cadence_state').update({ status, last_error: error }).eq('id', id);
}

async function cancelRemaining(supabase: SupabaseClient, contactId: string): Promise<void> {
  await supabase.from('cadence_state').update({ status: 'cancelled' }).eq('contact_id', contactId).eq('status', 'pending');
}

/** Reagenda o próximo step pendente ancorado no instante do envio atual (preserva o espaçamento). */
async function anchorNext(supabase: SupabaseClient, contactId: string, currentStep: number): Promise<void> {
  const cur = CADENCE_STEPS.find((s) => s.step === currentStep);
  if (!cur) return;
  const { data: nexts } = await supabase
    .from('cadence_state')
    .select('id, step')
    .eq('contact_id', contactId)
    .eq('status', 'pending')
    .gt('step', currentStep)
    .order('step')
    .limit(1);
  const next = Array.isArray(nexts) && nexts.length ? nexts[0] : null;
  if (!next) return;
  const nextDef = CADENCE_STEPS.find((s) => s.step === next.step);
  if (!nextDef) return;
  const deltaDays = nextDef.offsetDays - cur.offsetDays;
  if (deltaDays <= 0) return;
  const when = new Date(Date.now() + deltaDays * DAY_MS).toISOString();
  await supabase.from('cadence_state').update({ scheduled_at: when }).eq('id', next.id);
}

async function ensureEmailConversation(supabase: SupabaseClient, contactId: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('channel', 'email')
    .eq('is_active', true)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ contact_id: contactId, channel: 'email', status: 'nina', is_active: true })
    .select('id')
    .single();
  if (error) { console.error('[cadence] criar conversa falhou', error.message ?? error); return null; }
  return (created as { id: string }).id;
}

type SendResult = { ok: boolean; rateLimited: boolean; error: string | null; rfcMessageId: string | null };

async function callEmailSend(body: Record<string, unknown>): Promise<SendResult> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/email-send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 429 || (data as { code?: string }).code === 'rate_limited') {
      return { ok: false, rateLimited: true, error: (data as { error?: string }).error ?? 'rate_limited', rfcMessageId: null };
    }
    if (!resp.ok || (data as { error?: string }).error) {
      return { ok: false, rateLimited: false, error: (data as { error?: string }).error ?? `email-send ${resp.status}`, rfcMessageId: null };
    }
    return { ok: true, rateLimited: false, error: null, rfcMessageId: (data as { rfcMessageId?: string }).rfcMessageId ?? null };
  } catch (e) {
    return { ok: false, rateLimited: false, error: e instanceof Error ? e.message : String(e), rfcMessageId: null };
  }
}

/**
 * Monta os parâmetros do template de WhatsApp conforme o template escolhido — cada
 * template aprovado tem um número diferente de variáveis. A ordem/os campos vêm de
 * CADENCE_WA_PARAMS_STEP{n} (ex.: "name,title,company,company" para o
 * lis_abordagem_inicial, que usa {{1}} nome, {{2}} cargo, {{3}} e {{4}} empresa).
 * Tokens: name/nome, title/cargo, company/empresa, phone/telefone. Valores sempre
 * não-vazios (a Meta recusa parâmetro vazio). Assim dá para trocar de template só
 * mexendo no env, sem alterar código.
 */
function buildWaParams(step: number, contact: Contact, vars: { nome: string; empresa: string }): string[] {
  const spec = (Deno.env.get(`CADENCE_WA_PARAMS_STEP${step}`) || 'name,company').trim();
  const apollo = record(record(contact.client_memory).apollo);
  const cargo = (typeof apollo.title === 'string' && apollo.title.trim())
    || (typeof apollo.seniority === 'string' && apollo.seniority.trim())
    || 'diretoria';
  const resolve = (key: string): string => {
    switch (key.trim().toLowerCase()) {
      case 'name': case 'nome': return vars.nome;
      case 'title': case 'cargo': return cargo;
      case 'company': case 'empresa': return vars.empresa;
      case 'phone': case 'telefone': return contact.phone_number || vars.empresa;
      default: return key; // valor literal
    }
  };
  return spec.split(',').map((k) => k.trim()).filter(Boolean).map(resolve);
}

/** Template do step para a persona: CADENCE_WA_TEMPLATE_STEP{n}_{P1|P3}, senão o genérico do step. */
function waTemplateFor(step: number, persona: CadencePersona | null): string {
  const byPersona = persona ? (Deno.env.get(`CADENCE_WA_TEMPLATE_STEP${step}_${persona}`) || '').trim() : '';
  return byPersona || (Deno.env.get(`CADENCE_WA_TEMPLATE_STEP${step}`) || '').trim();
}

/**
 * Status do template na Meta (APPROVED, PENDING, REJECTED…), com cache por passada.
 * Enfileirar um template ainda em análise faria o envio falhar depois de o step
 * já estar marcado como enviado — por isso o worker só envia o que está APPROVED.
 */
const templateStatusCache = new Map<string, string>();
async function metaTemplateStatus(supabase: SupabaseClient, name: string, language: string): Promise<string> {
  const key = `${name}:${language}`;
  const cached = templateStatusCache.get(key);
  if (cached) return cached;
  let status = 'UNKNOWN';
  try {
    const { data: settings } = await supabase
      .from('nina_settings')
      .select('whatsapp_access_token, whatsapp_business_account_id')
      .not('whatsapp_access_token', 'is', null)
      .not('whatsapp_business_account_id', 'is', null)
      .limit(1)
      .maybeSingle();
    if (settings) {
      const url = `https://graph.facebook.com/v21.0/${settings.whatsapp_business_account_id}/message_templates`
        + `?name=${encodeURIComponent(name)}&fields=name,status,language&limit=20`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${settings.whatsapp_access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await resp.json().catch(() => ({}));
      const rows = Array.isArray(data?.data) ? data.data : [];
      // deno-lint-ignore no-explicit-any
      const match = rows.find((t: any) => t?.name === name && t?.language === language);
      if (match?.status) status = String(match.status);
      else if (resp.ok) status = 'NOT_FOUND';
    }
  } catch (e) {
    console.error('[cadence] consulta de template falhou', e instanceof Error ? e.message : String(e));
  }
  templateStatusCache.set(key, status);
  return status;
}

/**
 * Celular do contato. Lead da Apollo cujo telefone chegou depois pelo webhook de
 * revelação pode ter o número só em apollo_leads: copia para o contato aqui.
 */
async function ensureContactPhone(supabase: SupabaseClient, contact: Contact): Promise<string | null> {
  if (contact.phone_number) return contact.phone_number;
  const { data: lead } = await supabase
    .from('apollo_leads')
    .select('phone_number')
    .eq('contact_id', contact.id)
    .not('phone_number', 'is', null)
    .limit(1)
    .maybeSingle();
  const phone = lead?.phone_number ?? null;
  if (!phone) return null;
  const { error } = await supabase.from('contacts').update({ phone_number: phone }).eq('id', contact.id);
  if (error) {
    console.error('[cadence] não foi possível gravar o telefone no contato', contact.id, error.message ?? error);
    return null;
  }
  contact.phone_number = phone;
  return phone;
}

/**
 * Toque de WhatsApp da cadência (D3/D9) via template Meta aprovado, por persona.
 * Sem template configurado ou ainda não aprovado: espera (hold) se o step está em
 * CADENCE_WA_HOLD_STEPS, senão é pulado. Sem celular: pulado (o e-mail seguinte
 * mantém o dia). Usa enqueueTemplateForContact (mesma fila do whatsapp-sender) —
 * a função whatsapp-template-send exige token de usuário e não serve para o cron.
 */
async function trySendWhatsapp(
  supabase: SupabaseClient,
  contact: Contact,
  step: number,
): Promise<{ sent: boolean; hold: boolean; reason: string; messageId?: string }> {
  const required = waHoldSteps().includes(step);
  const template = waTemplateFor(step, personaOf(contact));
  if (!template) return { sent: false, hold: required, reason: 'whatsapp não configurado (template Meta pendente)' };
  const phone = await ensureContactPhone(supabase, contact);
  if (!phone) return { sent: false, hold: false, reason: 'sem telefone' };
  const language = (Deno.env.get('CADENCE_WA_LANGUAGE') || 'pt_BR').trim();
  const status = await metaTemplateStatus(supabase, template, language);
  if (status !== 'APPROVED') {
    return { sent: false, hold: required, reason: `template ${template} ainda não aprovado na Meta (${status})` };
  }
  const vars = renderVars(contact);
  try {
    const { messageId } = await enqueueTemplateWithMessage(supabase, {
      contact: { id: contact.id, name: contact.name ?? null, call_name: contact.call_name ?? null, phone_number: phone },
      name: template,
      language,
      bodyText: waTemplateBody(template),
      params: buildWaParams(step, contact, vars),
      asAgent: true,
    });
    fetch(`${supabaseUrl}/functions/v1/whatsapp-sender`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggered_by: 'cadence-worker' }),
    }).catch(() => {});
    return { sent: true, hold: false, reason: '', messageId };
  } catch (e) {
    return { sent: false, hold: required, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Situação da mensagem de WhatsApp (status do webhook da Meta + código de erro, se falhou). */
async function waDelivery(supabase: SupabaseClient, messageId: string): Promise<{ status: string; code: number | null }> {
  const { data } = await supabase.from('messages').select('status, metadata').eq('id', messageId).maybeSingle();
  const code = Number(record(record(data?.metadata).whatsapp_error).code);
  return { status: String(data?.status ?? 'desconhecido'), code: Number.isFinite(code) ? code : null };
}

/**
 * Playbook Passo 4: o WhatsApp 2 (D9) só sai se o WhatsApp 1 (D3) foi entregue.
 * Devolve o motivo para pular o toque, ou null se pode enviar (sem toque de
 * WhatsApp anterior na cadência não há o que conferir).
 */
async function previousWaUndelivered(supabase: SupabaseClient, contactId: string, step: number): Promise<string | null> {
  const prev = CADENCE_STEPS.filter((s) => s.channel === 'whatsapp' && s.step < step).pop();
  if (!prev) return null;
  const { data: row } = await supabase
    .from('cadence_state')
    .select('status, message_id')
    .eq('contact_id', contactId)
    .eq('step', prev.step)
    .maybeSingle();
  if (!row || row.status !== 'sent' || !row.message_id) {
    return `WhatsApp anterior (step ${prev.step}) não foi enviado`;
  }
  const delivery = await waDelivery(supabase, row.message_id);
  if (delivery.status === 'delivered' || delivery.status === 'read') return null;
  return `WhatsApp anterior (step ${prev.step}) não foi entregue (${delivery.status}${delivery.code ? ` ${delivery.code}` : ''})`;
}

/**
 * Uma nova tentativa para o toque de WhatsApp que a Meta barrou por limite de
 * marketing (ver WA_RETRY_CODES). Regras: no máximo WA_MAX_ATTEMPTS envios por toque,
 * pelo menos WA_RETRY_AFTER_MS depois do último, e só enquanto o próximo toque da
 * cadência ainda não venceu nem saiu. dryRun lista os candidatos sem enviar.
 */
async function runWaRetries(
  supabase: SupabaseClient,
  perPass: number,
  dryRun = false,
): Promise<Record<string, unknown>> {
  if (WA_RETRY_CODES.length === 0 || DAILY_WA_RETRY_MAX === 0) return { waRetried: 0 };
  let budget = Math.min(perPass, DAILY_WA_RETRY_MAX - await waRetriesToday(supabase));
  if (budget <= 0 && !dryRun) return { waRetried: 0 };

  const nowMs = Date.now();
  // Só toques cuja mensagem falhou (o join filtra no banco; entregues nem voltam).
  const { data: rows } = await supabase
    .from('cadence_state')
    .select('id, contact_id, step, attempts, message_id, sent_at, retried_at, messages!inner(status, metadata)')
    .eq('channel', 'whatsapp')
    .eq('status', 'sent')
    .eq('messages.status', 'failed')
    .lt('attempts', WA_MAX_ATTEMPTS)
    .lte('sent_at', new Date(nowMs - WA_RETRY_AFTER_MS).toISOString())
    .order('sent_at')
    .limit(100);

  // Encerra as tentativas do toque (não volta a ser avaliado nas próximas passadas).
  const giveUp = async (id: string, reason: string) => {
    if (!dryRun) await supabase.from('cadence_state').update({ attempts: WA_MAX_ATTEMPTS, last_error: reason }).eq('id', id);
  };

  let waRetried = 0;
  const candidates: Array<Record<string, unknown>> = [];
  for (const row of (rows ?? [])) {
    if (!dryRun && budget <= 0) break;
    const last = Date.parse(row.retried_at ?? row.sent_at);
    if (nowMs - last < WA_RETRY_AFTER_MS) continue;

    const code = Number(record(record(record(row.messages).metadata).whatsapp_error).code);
    // Sem código = falha anterior à captura do erro no webhook (27/10): conta como
    // retentável. Código conhecido fora da lista (ex.: número sem WhatsApp) encerra.
    const delivery = { code: Number.isFinite(code) && code > 0 ? code : null };
    if (delivery.code && !WA_RETRY_CODES.includes(delivery.code)) {
      await giveUp(row.id, `WhatsApp não entregue (${delivery.code}) — sem nova tentativa`);
      continue;
    }

    // O próximo toque já saiu ou já venceu: a nova tentativa chegaria fora de ordem.
    const { data: later } = await supabase
      .from('cadence_state')
      .select('id, status, scheduled_at')
      .eq('contact_id', row.contact_id)
      .gt('step', row.step)
      .in('status', ['sent', 'sending', 'pending']);
    const overtaken = (later ?? []).some((l: { status: string; scheduled_at: string }) =>
      l.status !== 'pending' || Date.parse(l.scheduled_at) <= nowMs);
    if (overtaken) {
      await giveUp(row.id, `WhatsApp barrado pela Meta (${delivery.code ?? 'sem código'}) — próximo toque já venceu, sem nova tentativa`);
      continue;
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, email, name, call_name, phone_number, tags, client_memory')
      .eq('id', row.contact_id)
      .maybeSingle();
    if (!contact || isSuppressed(contact) || hasReplied(contact)) {
      await giveUp(row.id, 'sem nova tentativa: contato suprimido, removido ou já respondeu');
      continue;
    }

    if (dryRun) {
      candidates.push({ contactId: row.contact_id, name: contact.name, step: row.step, code: delivery.code, sentAt: row.sent_at });
      continue;
    }

    const wa = await trySendWhatsapp(supabase, contact, row.step);
    if (wa.sent) {
      await supabase.from('cadence_state').update({
        message_id: wa.messageId ?? row.message_id,
        attempts: (row.attempts || 1) + 1,
        retried_at: new Date().toISOString(),
        last_error: `nova tentativa após falha ${delivery.code ?? 'sem código'} na Meta`,
      }).eq('id', row.id);
      waRetried += 1;
      budget -= 1;
    } else if (!wa.hold) {
      await giveUp(row.id, `sem nova tentativa: ${wa.reason}`);
    }
  }
  return dryRun ? { candidates } : { waRetried };
}

/** Domínio da empresa do contato (chave de agrupamento): domínio do e-mail ou o da Apollo. */
function companyDomainOf(contact: Contact): string | null {
  const email = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : '';
  const at = email.lastIndexOf('@');
  if (at > 0) return email.slice(at + 1);
  const apollo = record(record(contact.client_memory).apollo);
  return typeof apollo.company_domain === 'string' && apollo.company_domain ? apollo.company_domain.toLowerCase() : null;
}

/**
 * Playbook 1.2 (regra de conta): no máximo 1 contato por empresa em sequência ativa.
 * Ninguém recebe mensagens de duas pessoas da mesma empresa ao mesmo tempo, e a outra
 * persona só entra 30 dias depois do último toque enviado à empresa. Agrupa pelo
 * domínio do e-mail.
 */
async function companyHasActiveSequence(supabase: SupabaseClient, contact: Contact): Promise<boolean> {
  const domain = companyDomainOf(contact);
  if (!domain) return false; // sem domínio não há como agrupar — não bloqueia
  const { data: peers } = await supabase
    .from('contacts')
    .select('id')
    .ilike('email', `%@${domain}`)
    .neq('id', contact.id)
    .limit(100);
  const ids = (peers ?? []).map((p: { id: string }) => p.id);
  if (ids.length === 0) return false;
  const { data: active } = await supabase
    .from('cadence_state')
    .select('contact_id')
    .in('contact_id', ids)
    .in('status', ['pending', 'sending'])
    .limit(1);
  if (Array.isArray(active) && active.length > 0) return true;
  const { data: recent } = await supabase
    .from('cadence_state')
    .select('contact_id')
    .in('contact_id', ids)
    .eq('status', 'sent')
    .gte('sent_at', new Date(Date.now() - COMPANY_COOLDOWN_DAYS * DAY_MS).toISOString())
    .limit(1);
  return Array.isArray(recent) && recent.length > 0;
}

/** Matricula um contato na cadência (idempotente via índice único contact_id,step). */
async function enrollContact(supabase: SupabaseClient, contact: Contact): Promise<boolean> {
  if (notEligible(contact)) return false;
  if (await companyHasActiveSequence(supabase, contact)) {
    console.log('[cadence] já há contato da mesma empresa em sequência ativa — não matricula', contact.id);
    return false;
  }
  const now = Date.now();
  const rows = ENABLED_STEPS.map((s) => ({
    contact_id: contact.id,
    step: s.step,
    tipo: s.tipo,
    channel: s.channel,
    scheduled_at: new Date(now + s.offsetDays * DAY_MS).toISOString(),
    status: 'pending',
  }));
  const { error } = await supabase
    .from('cadence_state')
    .upsert(rows, { onConflict: 'contact_id,step', ignoreDuplicates: true });
  if (error) { console.error('[cadence] enroll falhou', error.message ?? error); return false; }
  return true;
}

/** Matricula automaticamente leads apollo qualificados ainda sem cadência. */
async function autoEnroll(supabase: SupabaseClient, limit: number): Promise<number> {
  const { data: candidates } = await supabase
    .from('contacts')
    .select('id, email, name, call_name, phone_number, tags, client_memory')
    .contains('tags', ['apollo'])
    .not('email', 'is', null)
    .limit(limit * 3);
  let enrolled = 0;
  for (const c of (candidates ?? [])) {
    if (enrolled >= limit) break;
    if (notEligible(c)) continue;
    const { data: existing } = await supabase.from('cadence_state').select('id').eq('contact_id', c.id).limit(1);
    if (Array.isArray(existing) && existing.length) continue;
    if (await enrollContact(supabase, c)) enrolled += 1;
  }
  return enrolled;
}

/**
 * Lembrete de reunião por WhatsApp (template utilitário aprovado — ex.:
 * lis_lembrete_reuniao_v1). Opt-in: só roda com CADENCE_REMINDER_WA_TEMPLATE setado.
 * Envia um lembrete único (marca appointments.metadata.reminded) para reuniões que
 * acontecem nas próximas CADENCE_REMINDER_HOURS (default 24h). As variáveis vêm de
 * CADENCE_REMINDER_PARAMS (tokens: name, company, datetime, time). Roda fora da janela
 * da cadência porque está atrelado à hora da reunião, não ao disparo frio.
 */
async function runReminders(supabase: SupabaseClient): Promise<Record<string, unknown>> {
  const template = (Deno.env.get('CADENCE_REMINDER_WA_TEMPLATE') || '').trim();
  if (!template) return {};
  const HOUR_MS = 3_600_000;
  const hours = Math.max(1, Number(Deno.env.get('CADENCE_REMINDER_HOURS') || '24'));
  const language = (Deno.env.get('CADENCE_WA_LANGUAGE') || 'pt_BR').trim();
  const spec = (Deno.env.get('CADENCE_REMINDER_PARAMS') || 'name,datetime').trim();

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const horizonStr = new Date(now.getTime() + hours * HOUR_MS).toISOString().slice(0, 10);

  const { data: appts } = await supabase
    .from('appointments')
    .select('id, date, time, metadata, contact:contacts(id, name, call_name, phone_number, client_memory)')
    .eq('status', 'scheduled')
    .gte('date', todayStr)
    .lte('date', horizonStr)
    .limit(100);

  let remindersSent = 0, remindersSkipped = 0;
  for (const appt of (appts ?? [])) {
    const meta = record(appt.metadata);
    const contact: Contact = record(appt.contact);
    if (meta.reminded === true || !contact.phone_number) { remindersSkipped += 1; continue; }
    const when = new Date(`${appt.date}T${String(appt.time || '09:00').slice(0, 5)}:00-03:00`);
    const diffMs = when.getTime() - now.getTime();
    if (diffMs <= 0 || diffMs > hours * HOUR_MS) { remindersSkipped += 1; continue; }
    const vars = renderVars(contact);
    const opts = { timeZone: 'America/Sao_Paulo' } as const;
    const dtLabel = when.toLocaleString('pt-BR', { ...opts, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const params = spec.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean).map((k) => {
      switch (k) {
        case 'name': case 'nome': return vars.nome;
        case 'company': case 'empresa': return vars.empresa;
        case 'datetime': case 'data': return dtLabel;
        case 'time': case 'hora': return when.toLocaleTimeString('pt-BR', { ...opts, hour: '2-digit', minute: '2-digit' });
        default: return k;
      }
    });
    try {
      await enqueueTemplateForContact(supabase, {
        contact: { id: contact.id, name: contact.name ?? null, call_name: contact.call_name ?? null, phone_number: contact.phone_number },
        name: template, language, bodyText: '', params,
      });
      fetch(`${supabaseUrl}/functions/v1/whatsapp-sender`, {
        method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by: 'cadence-reminder' }),
      }).catch(() => {});
      await supabase.from('appointments').update({ metadata: { ...meta, reminded: true, reminded_at: new Date().toISOString() } }).eq('id', appt.id);
      remindersSent += 1;
    } catch (e) {
      console.error('[cadence] lembrete falhou', e instanceof Error ? e.message : String(e));
      remindersSkipped += 1;
    }
  }
  return { remindersSent, remindersSkipped };
}

async function runPass(supabase: SupabaseClient): Promise<Record<string, unknown>> {
  // 1) Reclaim de órfãos presos em 'sending' (passada anterior morreu / cron sobrepôs).
  await supabase
    .from('cadence_state')
    .update({ status: 'pending' })
    .eq('status', 'sending')
    .lt('updated_at', new Date(Date.now() - ORPHAN_MS).toISOString());

  // Lembretes de reunião — rodam sempre (ligados à hora da reunião, não à janela fria).
  const reminders = await runReminders(supabase);

  // 2) Janela útil (só para os toques frios da cadência).
  if (!withinWindow()) return { skipped: 'fora da janela útil (9-17h, dia útil)', ...reminders };
  if (!isSendDay()) return { skipped: 'fora dos dias de envio do piloto (terça a quinta)', ...reminders };
  let sentToday = await emailsSentToday(supabase);
  let waToday = await whatsappSentToday(supabase);
  if (sentToday >= DAILY_EMAIL_MAX && waToday >= DAILY_WA_MAX && !isRetryWindow()) {
    return { skipped: `limites diários atingidos (e-mail ${sentToday}/${DAILY_EMAIL_MAX}, WhatsApp ${waToday}/${DAILY_WA_MAX})`, ...reminders };
  }
  templateStatusCache.clear(); // status de aprovação na Meta é relido a cada passada

  // 3) Auto-matrícula de novos qualificados.
  const enrolled = await autoEnroll(supabase, ENROLL_PER_RUN);

  // 4) Steps devidos.
  const nowIso = new Date().toISOString();
  const { data: due } = await supabase
    .from('cadence_state')
    .select('id, contact_id, step, tipo, channel')
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at')
    .limit(BATCH);

  let sent = 0, skipped = 0, held = 0, errors = 0, rateLimited = false, waThisPass = 0;
  for (const item of (due ?? [])) {
    if (item.channel === 'email') {
      if (sentToday >= DAILY_EMAIL_MAX) continue; // cota do dia cheia: o resto fica para amanhã
      if (item.step === OPENING_STEP && !isOpeningWindow()) continue; // abertura só de manhã
    } else if (waToday >= DAILY_WA_MAX || waThisPass >= WA_PER_PASS) {
      continue; // cota de WhatsApp (do dia ou da passada) cheia
    }

    // Guarda de ordem: não envia um step com anterior ainda pendente/em envio.
    const { data: earlier } = await supabase
      .from('cadence_state')
      .select('id')
      .eq('contact_id', item.contact_id)
      .lt('step', item.step)
      .in('status', ['pending', 'sending'])
      .limit(1);
    if (Array.isArray(earlier) && earlier.length) continue;

    // Claim atômico.
    const { data: claimed } = await supabase
      .from('cadence_state')
      .update({ status: 'sending' })
      .eq('id', item.id)
      .eq('status', 'pending')
      .select('id');
    if (!Array.isArray(claimed) || claimed.length === 0) continue;

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, email, name, call_name, phone_number, tags, client_memory')
      .eq('id', item.contact_id)
      .maybeSingle();
    if (!contact) { await markStep(supabase, item.id, 'cancelled', 'contato removido'); continue; }

    if (isSuppressed(contact) || hasReplied(contact)) {
      await cancelRemaining(supabase, contact.id);
      await markStep(supabase, item.id, 'cancelled', 'suprimido ou já respondeu');
      skipped += 1;
      continue;
    }

    // Toque de WhatsApp (D3/D9): envia via template Meta se configurado; senão pula.
    if (item.channel !== 'email') {
      const undelivered = await previousWaUndelivered(supabase, contact.id, item.step);
      if (undelivered) {
        await markStep(supabase, item.id, 'skipped', undelivered);
        skipped += 1;
        continue;
      }
      const wa = await trySendWhatsapp(supabase, contact, item.step);
      if (wa.sent) {
        await supabase.from('cadence_state').update({
          status: 'sent', sent_at: new Date().toISOString(), last_error: null,
          message_id: wa.messageId ?? null, attempts: 1,
        }).eq('id', item.id);
        sent += 1;
        waToday += 1;
        waThisPass += 1;
        await anchorNext(supabase, contact.id, item.step);
      } else if (wa.hold) {
        // Toque obrigatório ainda sem template aprovado: volta para a fila e tenta
        // de novo em 30 min. Os steps seguintes esperam (guarda de ordem).
        await supabase.from('cadence_state')
          .update({ status: 'pending', scheduled_at: holdRetryIso(), last_error: wa.reason })
          .eq('id', item.id);
        held += 1;
      } else {
        // Toque pulado não reancora: o e-mail seguinte mantém o dia do playbook
        // (sem isso o D6 virava D9 sempre que o WhatsApp estava desligado).
        await markStep(supabase, item.id, 'skipped', wa.reason);
        skipped += 1;
      }
      continue;
    }

    const persona = personaOf(contact);
    const tpl = persona ? renderCadenceEmail(persona, item.step, renderVars(contact)) : null;
    if (!tpl) { await markStep(supabase, item.id, 'skipped', 'sem template/persona'); continue; }

    const conversationId = await ensureEmailConversation(supabase, contact.id);
    if (!conversationId) { await markStep(supabase, item.id, 'pending', 'sem conversa'); errors += 1; continue; }

    // Threading forte: encadeia este e-mail no anterior da cadência (Message-ID
    // guardado em lead_state.email_thread). O 1º e-mail (abertura) não tem âncora.
    const thread = record(record(contact.client_memory).lead_state).email_thread;
    const threadRec = record(thread);
    const inReplyTo = typeof threadRec.last_message_id === 'string' ? threadRec.last_message_id : undefined;
    const references = typeof threadRec.references === 'string' ? threadRec.references : undefined;

    const res = await callEmailSend({ to: contact.email, subject: tpl.subject, text: tpl.body, conversationId, inReplyTo, references });
    if (res.rateLimited) {
      await supabase.from('cadence_state').update({ status: 'pending' }).eq('id', item.id); // volta pra fila
      rateLimited = true;
      break; // cota cheia: encerra a passada, o resto fica para o próximo ciclo
    }
    if (!res.ok) {
      await supabase.from('cadence_state').update({ status: 'pending', last_error: res.error }).eq('id', item.id);
      errors += 1;
      continue;
    }
    await supabase.from('cadence_state').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', item.id);
    sent += 1;
    sentToday += 1;
    // Guarda o Message-ID como âncora do próximo step (preserva o fio da thread).
    if (res.rfcMessageId) {
      const mem = record(contact.client_memory);
      const ls = record(mem.lead_state);
      const newRefs = references ? `${references} ${res.rfcMessageId}` : res.rfcMessageId;
      await supabase.from('contacts').update({
        client_memory: { ...mem, lead_state: { ...ls, email_thread: { last_message_id: res.rfcMessageId, references: newRefs } } },
      }).eq('id', contact.id);
    }
    await anchorNext(supabase, contact.id, item.step);
  }

  // 5) Nova tentativa dos WhatsApps barrados pela Meta (à tarde, cota própria).
  const waRetry = isRetryWindow() ? await runWaRetries(supabase, WA_PER_PASS) : {};

  return { enrolled, sent, skipped, held, errors, rateLimited, ...waRetry, ...reminders };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const supabase = createClient(supabaseUrl, serviceKey);
  if (!(await authenticate(req, supabase))) return json({ error: 'Não autorizado' }, 401);

  try {
    const body = record(await req.json().catch(() => ({})));
    const action = typeof body.action === 'string' ? body.action : 'run';

    if (action === 'enroll') {
      if (typeof body.contactId === 'string' && body.contactId) {
        const { data: contact } = await supabase
          .from('contacts').select('id, email, name, call_name, tags, client_memory').eq('id', body.contactId).maybeSingle();
        if (!contact) return json({ error: 'Contato não encontrado' }, 404);
        const ok = await enrollContact(supabase, contact);
        return json({ ok, enrolled: ok ? 1 : 0 });
      }
      const limit = Math.min(Math.max(Number(body.limit) || ENROLL_PER_RUN, 1), 200);
      const enrolled = await autoEnroll(supabase, limit);
      return json({ ok: true, enrolled });
    }

    // Playbook 7.2: testar o toque com um contato interno antes do lote. Envia o
    // template do step para UM contato (persona informada se ele não tiver uma),
    // sem janela, sem cota e sem mexer em cadence_state.
    if (action === 'test_whatsapp') {
      if (typeof body.contactId !== 'string' || !body.contactId) return json({ error: 'contactId obrigatório' }, 400);
      const step = Number(body.step) || 2;
      const { data: contact } = await supabase
        .from('contacts').select('id, email, name, call_name, phone_number, tags, client_memory').eq('id', body.contactId).maybeSingle();
      if (!contact) return json({ error: 'Contato não encontrado' }, 404);
      if (!personaOf(contact) && (body.persona === 'P1' || body.persona === 'P3')) {
        const mem = record(contact.client_memory);
        contact.client_memory = { ...mem, apollo: { ...record(mem.apollo), persona: body.persona } };
      }
      return json({ ok: true, ...(await trySendWhatsapp(supabase, contact, step)) });
    }

    // Quem receberia a nova tentativa de WhatsApp agora (sem enviar nada).
    if (action === 'wa_retry_preview') {
      return json({ ok: true, ...(await runWaRetries(supabase, 0, true)) });
    }

    if (action !== 'run') return json({ error: 'Ação desconhecida' }, 400);
    return json({ ok: true, ...(await runPass(supabase)) });
  } catch (error) {
    console.error('[cadence-worker] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Erro interno' }, 500);
  }
});
