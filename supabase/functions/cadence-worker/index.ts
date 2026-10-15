import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserFromToken } from "../_shared/auth.ts";
import {
  CADENCE_STEPS,
  ENABLED_STEPS,
  renderCadenceEmail,
  type CadencePersona,
} from "../_shared/cadence-templates.ts";
import { isExcludedEmail } from "../_shared/exclusions.ts";
import { enqueueTemplateForContact } from "../_shared/template-dispatch.ts";

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
// fica desligado nos steps até o template da Meta ser aprovado (ENABLED_STEPS cobre só os
// e-mails: D0, D6, D13).

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

/** Janela útil 9-17h BRT (UTC-3), dia útil. CADENCE_IGNORE_WINDOW=true libera (só ensaio). */
function withinWindow(): boolean {
  if (Deno.env.get('CADENCE_IGNORE_WINDOW') === 'true') return true;
  const br = new Date(Date.now() - 3 * 3_600_000);
  const day = br.getUTCDay(); // 0=domingo, 6=sábado
  if (day === 0 || day === 6) return false;
  const hour = br.getUTCHours();
  return hour >= 9 && hour < 17;
}

async function authenticate(req: Request, supabase: SupabaseClient): Promise<boolean> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  if (token === serviceKey) return true; // cron / chamada interna
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

/**
 * Toque de WhatsApp da cadência (D3/D9) via template Meta aprovado. Só envia se o
 * template do step estiver configurado por env (CADENCE_WA_TEMPLATE_STEP{n}) e o
 * contato tiver telefone; senão devolve {sent:false} e o worker pula o step.
 * Usa enqueueTemplateForContact (mesma fila do whatsapp-sender) — a função
 * whatsapp-template-send exige token de usuário e não serve para o cron.
 */
async function trySendWhatsapp(supabase: SupabaseClient, contact: Contact, step: number): Promise<{ sent: boolean; reason: string }> {
  const template = (Deno.env.get(`CADENCE_WA_TEMPLATE_STEP${step}`) || '').trim();
  if (!template) return { sent: false, reason: 'whatsapp não configurado (template Meta pendente)' };
  if (!contact.phone_number) return { sent: false, reason: 'sem telefone' };
  const language = (Deno.env.get('CADENCE_WA_LANGUAGE') || 'pt_BR').trim();
  const vars = renderVars(contact);
  try {
    await enqueueTemplateForContact(supabase, {
      contact: { id: contact.id, name: contact.name ?? null, call_name: contact.call_name ?? null, phone_number: contact.phone_number },
      name: template,
      language,
      bodyText: '',
      params: buildWaParams(step, contact, vars),
    });
    fetch(`${supabaseUrl}/functions/v1/whatsapp-sender`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggered_by: 'cadence-worker' }),
    }).catch(() => {});
    return { sent: true, reason: '' };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
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
 * Ninguém recebe mensagens de duas pessoas da mesma empresa ao mesmo tempo — a outra
 * persona só entra depois. Agrupa pelo domínio do e-mail.
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
  return Array.isArray(active) && active.length > 0;
}

/** Matricula um contato na cadência (idempotente via índice único contact_id,step). */
async function enrollContact(supabase: SupabaseClient, contact: Contact): Promise<boolean> {
  if (!contact.email || !personaOf(contact) || isSuppressed(contact) || hasReplied(contact)) return false;
  if (isExcludedEmail(contact.email)) return false; // domínio próprio / cliente ativo
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
    if (isSuppressed(c) || hasReplied(c) || !personaOf(c) || isExcludedEmail(c.email)) continue;
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

  let sent = 0, skipped = 0, errors = 0, rateLimited = false;
  for (const item of (due ?? [])) {
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
      const wa = await trySendWhatsapp(supabase, contact, item.step);
      if (wa.sent) {
        await supabase.from('cadence_state').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', item.id);
        sent += 1;
      } else {
        await markStep(supabase, item.id, 'skipped', wa.reason);
        skipped += 1;
      }
      await anchorNext(supabase, contact.id, item.step);
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

  return { enrolled, sent, skipped, errors, rateLimited, ...reminders };
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

    if (action !== 'run') return json({ error: 'Ação desconhecida' }, 400);
    return json({ ok: true, ...(await runPass(supabase)) });
  } catch (error) {
    console.error('[cadence-worker] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Erro interno' }, 500);
  }
});
