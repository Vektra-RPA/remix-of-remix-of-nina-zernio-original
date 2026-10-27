import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Agenda via Google Calendar com SERVICE ACCOUNT + delegação em todo o domínio.
// Porte do src/agente/google_calendar_client.py da Lis (Python): a conta de
// serviço "se passa" pelo dono da agenda (ex.: o Fabiano) via impersonação
// (JWT com `sub`), sem o Fabiano precisar conectar/autorizar nada. Cria o evento
// de venda na agenda `primary` dele, com Google Meet, e convida o lead + extras
// (ex.: Patricia). Reaproveita o projeto GCP / a service account / a delegação
// que o Erick já montou — aqui é só a "casquinha" na linguagem da Nina (Deno).
//
// Opt-in por env: só roda com GOOGLE_SERVICE_ACCOUNT_JSON (o conteúdo da chave
// JSON) e FABIANO_CALENDAR_EMAIL (o e-mail da agenda a impersonar) setados.
// Convidados extras fixos (ex.: Patricia) vêm de MEETING_EXTRA_ATTENDEES
// (lista separada por vírgula). Chamada interna apenas (service role).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

// Exatamente os escopos autorizados na delegação do Admin Console (os mesmos do
// google_calendar_client.py). Pedir um escopo fora da lista faz o Google negar o token.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = (Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.client_email === 'string' && typeof parsed?.private_key === 'string') {
      return { client_email: parsed.client_email, private_key: parsed.private_key };
    }
  } catch (e) {
    console.error('[google-calendar] GOOGLE_SERVICE_ACCOUNT_JSON inválido:', e instanceof Error ? e.message : String(e));
  }
  return null;
}

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/** Access token OAuth2 impersonando `subject` (delegação em todo o domínio). */
async function getAccessToken(sa: ServiceAccount, subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    sub: subject,
    scope: SCOPES.join(' '),
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  ));
  const jwt = `${unsigned}.${base64url(sig)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`token exchange falhou (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.access_token as string;
}

/** São Paulo (UTC-3, sem horário de verão) em ISO8601 com offset -03:00. */
function toSaoPauloIso(ms: number): string {
  const d = new Date(ms - 3 * 3600 * 1000); // desloca para ler o horário de parede via métodos UTC
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00-03:00`;
}

async function createEvent(token: string, calendarId: string, event: unknown): Promise<any> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`events.insert falhou (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  // 410 = já removido; tratamos como sucesso.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`events.delete falhou (${res.status})`);
  }
}

function emailList(envName: string): string[] {
  return (Deno.env.get(envName) || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
}

function extraAttendees(): string[] {
  return emailList('MEETING_EXTRA_ATTENDEES');
}

/** Convidados opcionais (ex.: Patrícia na reunião de venda) — não bloqueiam o horário. */
function optionalAttendees(): string[] {
  return emailList('MEETING_OPTIONAL_ATTENDEES');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Chamada interna apenas (nina-orchestrator com service role).
  const { requireServiceRole } = await import("../_shared/auth.ts");
  const authFail = requireServiceRole(req, corsHeaders);
  if (authFail) return authFail;

  const sa = loadServiceAccount();
  const organizer = (Deno.env.get('FABIANO_CALENDAR_EMAIL') || '').trim();
  if (!sa || !organizer) {
    return json({ ok: false, skipped: 'google calendar não configurado (defina GOOGLE_SERVICE_ACCOUNT_JSON e FABIANO_CALENDAR_EMAIL)' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : 'sync_event';

    // Diagnóstico só-leitura: confirma chave + delegação + acesso à agenda do
    // organizador sem criar nada (lista no máximo 1 evento futuro, só a contagem).
    if (action === 'check') {
      const token = await getAccessToken(sa, organizer);
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&singleEvents=true&timeMin=${encodeURIComponent(new Date().toISOString())}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ ok: false, error: `events.list falhou (${res.status}): ${JSON.stringify(data).slice(0, 300)}` }, 502);
      return json({ ok: true, organizer, timeZone: data.timeZone ?? null, upcomingSample: Array.isArray(data.items) ? data.items.length : 0 });
    }

    // Ocupado/livre na agenda real do organizador (porte do buscar_slots_livres do
    // Python): pega reuniões marcadas fora da Nina antes de a Lis oferecer o horário.
    if (action === 'freebusy') {
      const date = String(body.date || '');
      const time = String(body.time || '').slice(0, 5);
      const duration = Number(body.duration) || 30;
      const startMs = Date.parse(`${date}T${time}:00-03:00`);
      if (Number.isNaN(startMs)) return json({ ok: false, error: 'data/hora inválida' }, 400);
      const token = await getAccessToken(sa, organizer);
      const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: new Date(startMs).toISOString(),
          timeMax: new Date(startMs + duration * 60_000).toISOString(),
          items: [{ id: organizer }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ ok: false, error: `freebusy falhou (${res.status})` }, 502);
      const calendar = data.calendars?.[organizer] ?? {};
      if (Array.isArray(calendar.errors) && calendar.errors.length > 0) {
        return json({ ok: false, error: `sem acesso à agenda: ${JSON.stringify(calendar.errors).slice(0, 200)}` }, 502);
      }
      return json({ ok: true, busy: Array.isArray(calendar.busy) && calendar.busy.length > 0 });
    }

    const appointmentId = typeof body.appointmentId === 'string' ? body.appointmentId : '';
    if (!appointmentId) return json({ ok: false, error: 'appointmentId obrigatório' }, 400);

    const { data: appt, error: apptErr } = await supabase
      .from('appointments')
      .select('id, title, date, time, duration, description, status, metadata, contact:contacts(name, call_name, email)')
      .eq('id', appointmentId)
      .maybeSingle();
    if (apptErr || !appt) return json({ ok: false, error: 'agendamento não encontrado' }, 404);

    const meta = (appt.metadata && typeof appt.metadata === 'object') ? appt.metadata : {};
    const token = await getAccessToken(sa, organizer);

    if (action === 'delete_event') {
      const eventId = typeof meta.google_event_id === 'string' ? meta.google_event_id : '';
      if (!eventId) return json({ ok: true, skipped: 'sem evento Google para remover' });
      await deleteEvent(token, 'primary', eventId);
      await supabase.from('appointments').update({
        metadata: { ...meta, google_event_id: null, google_deleted_at: new Date().toISOString() },
      }).eq('id', appt.id);
      return json({ ok: true, deleted: true });
    }

    // sync_event (default): cria o evento na agenda do organizador (impersonado).
    const date = String(appt.date);
    const time = String(appt.time || '09:00').slice(0, 5);
    const duration = Number(appt.duration) || 30;
    const startMs = Date.parse(`${date}T${time}:00-03:00`);
    if (Number.isNaN(startMs)) return json({ ok: false, error: 'data/hora inválida' }, 400);

    const contact = (appt.contact && typeof appt.contact === 'object') ? appt.contact : {};
    const leadEmail = typeof contact.email === 'string' && contact.email.includes('@') ? contact.email.trim() : null;
    const required = Array.from(new Set([
      ...(leadEmail ? [leadEmail.toLowerCase()] : []),
      ...extraAttendees(),
    ]));
    const attendees = [
      ...required.map((email) => ({ email })),
      ...optionalAttendees()
        .filter((email) => !required.includes(email) && email !== organizer.toLowerCase())
        .map((email) => ({ email, optional: true })),
    ];

    const event = {
      summary: appt.title || 'Reunião de venda — Trajetória',
      description: typeof appt.description === 'string' ? appt.description : '',
      start: { dateTime: toSaoPauloIso(startMs), timeZone: 'America/Sao_Paulo' },
      end: { dateTime: toSaoPauloIso(startMs + duration * 60000), timeZone: 'America/Sao_Paulo' },
      attendees,
      reminders: { useDefault: true },
      conferenceData: {
        createRequest: {
          requestId: `lis-${appt.id}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    const created = await createEvent(token, 'primary', event);
    const entryPoints = created?.conferenceData?.entryPoints;
    const video = Array.isArray(entryPoints) ? entryPoints.find((e: any) => e?.entryPointType === 'video') : null;
    const meetLink = video?.uri || null;

    await supabase.from('appointments').update({
      metadata: {
        ...meta,
        google_event_id: created?.id ?? null,
        google_html_link: created?.htmlLink ?? null,
        meet_link: meetLink,
        google_organizer: organizer,
        google_synced_at: new Date().toISOString(),
      },
    }).eq('id', appt.id);

    return json({ ok: true, event_id: created?.id ?? null, meet_link: meetLink });
  } catch (error) {
    console.error('[google-calendar] erro:', error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: error instanceof Error ? error.message : 'erro interno' }, 500);
  }
});
