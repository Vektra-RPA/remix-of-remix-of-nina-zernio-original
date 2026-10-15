// Identidade unificada do lead no CRM.
//
// Uma pessoa é UMA só, mesmo chegando por e-mail e por WhatsApp. Este módulo
// casa (ou cria) o contato a partir de e-mail e/ou telefone e guarda os
// metadados de CRM (persona, score, empresa, origem) em `contacts.client_memory`
// — sem exigir novas colunas no banco. É usado pela captação Apollo e pode ser
// reaproveitado pelo inbound (formulário/WhatsApp).

// Os tipos remotos do Supabase inferem as tabelas como `never` sem o generic
// Database; o acesso usa o mesmo cast local das demais functions do repo.
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type Persona = 'P1' | 'P3' | null;

// P1 = dono/sócio; P3 = diretor administrativo-financeiro (playbook Indústrias).
const P1_TITLES = [
  'owner', 'founder', 'co-founder', 'cofounder', 'ceo', 'chief executive',
  'presidente', 'president', 'sócio', 'socio', 'sócio-diretor', 'socio-diretor',
  'proprietário', 'proprietario', 'managing director', 'dono',
];
const P3_TITLES = [
  'cfo', 'chief financial', 'controller', 'controladoria', 'controladora',
  'diretor administrativo', 'diretora administrativa', 'diretor financeiro',
  'diretora financeira', 'administrativo e financeiro', 'diretor adm',
  'gerente financeiro', 'gerente administrativo', 'finance director',
];

/** Deriva a persona (P1/P3) pelo cargo; null quando não se encaixa. */
export function derivePersona(title?: string | null, seniority?: string | null): Persona {
  const haystack = `${title ?? ''} ${seniority ?? ''}`.toLowerCase();
  if (!haystack.trim()) return null;
  if (P1_TITLES.some((word) => haystack.includes(word))) return 'P1';
  if (P3_TITLES.some((word) => haystack.includes(word))) return 'P3';
  return null;
}

function normalizeEmail(email?: string | null): string | null {
  const value = (email ?? '').trim().toLowerCase();
  return value && value.includes('@') ? value : null;
}

export interface UnifiedLeadInput {
  email?: string | null;
  /** Telefone já normalizado em E.164 (ver apollo.normalizeBrazilMobile). */
  phone?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  title?: string | null;
  seniority?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companyIndustry?: string | null;
  companyEmployees?: number | null;
  linkedinUrl?: string | null;
  emailStatus?: string | null;
  score?: number | null;
  scoreReasons?: unknown;
  apolloPersonId?: string | null;
  /** Origem do lead: 'apollo' | 'inbound_form' | 'inbound_wa' | 'manual'. */
  origin?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasValue(field: unknown): boolean {
  const f = record(field);
  return typeof f.value === 'string' ? f.value.trim().length > 0 : Boolean(f.value);
}

type ContactRow = {
  id: string;
  email: string | null;
  phone_number: string | null;
  name: string | null;
  call_name: string | null;
  tags: string[] | null;
  client_memory: Record<string, unknown> | null;
};

const CONTACT_COLS = 'id, email, phone_number, name, call_name, tags, client_memory';

/**
 * Procura o contato por e-mail (identidade mais estável) e por telefone. Prevalece
 * o do e-mail. NÃO funde registros (fusão é destrutiva): quando e-mail e telefone
 * apontam para contatos DIFERENTES, devolve o primário + o `conflict` para a rotina
 * chamadora sinalizar e um humano decidir a fusão (dedup de identidade divergente).
 */
async function findContact(
  service: SupabaseClient,
  email: string | null,
  phone: string | null,
): Promise<{ primary: ContactRow | null; conflict: ContactRow | null }> {
  let byEmail: ContactRow | null = null;
  let byPhone: ContactRow | null = null;
  if (email) {
    const { data } = await service.from('contacts').select(CONTACT_COLS).ilike('email', email).limit(1);
    if (Array.isArray(data) && data.length > 0) byEmail = data[0] as ContactRow;
  }
  if (phone) {
    const { data } = await service.from('contacts').select(CONTACT_COLS).eq('phone_number', phone).limit(1);
    if (Array.isArray(data) && data.length > 0) byPhone = data[0] as ContactRow;
  }
  const primary = byEmail ?? byPhone;
  const conflict = (byEmail && byPhone && byEmail.id !== byPhone.id)
    ? (primary === byEmail ? byPhone : byEmail)
    : null;
  return { primary, conflict };
}

/**
 * Garante UMA pessoa única no CRM a partir de e-mail e/ou telefone.
 * Preenche lacunas (e-mail/telefone/nome) sem sobrescrever o que já existe,
 * grava os metadados de CRM em `client_memory.apollo` e semeia
 * `client_memory.lead_state` (company/role) como "inferido" — contexto para a
 * Lis sem virar fato confirmado. Retorna o id do contato, ou null se não houver
 * e-mail nem telefone (sem âncora de identidade não há o que criar).
 */
export async function upsertUnifiedContact(
  service: SupabaseClient,
  input: UnifiedLeadInput,
): Promise<string | null> {
  const email = normalizeEmail(input.email);
  const phone = (input.phone ?? '').trim() || null;
  if (!email && !phone) return null;

  const persona = derivePersona(input.title, input.seniority);
  const origin = input.origin ?? 'apollo';
  const apolloMeta = {
    person_id: input.apolloPersonId ?? null,
    persona,
    score: input.score ?? null,
    score_reasons: input.scoreReasons ?? null,
    title: input.title ?? null,
    seniority: input.seniority ?? null,
    company: input.companyName ?? null,
    company_domain: input.companyDomain ?? null,
    company_industry: input.companyIndustry ?? null,
    company_employees: input.companyEmployees ?? null,
    linkedin: input.linkedinUrl ?? null,
    email_status: input.emailStatus ?? null,
    origin,
    synced_at: new Date().toISOString(),
  };
  const baseTags = [origin, ...(persona ? [persona] : [])];

  const { primary: existing, conflict } = await findContact(service, email, phone);
  if (conflict) {
    console.warn('[lead-identity] identidade divergente: e-mail e telefone em contatos diferentes', existing?.id, conflict.id);
  }

  if (existing) {
    const memory = record(existing.client_memory);
    const leadState = record(memory.lead_state);
    // Semeia só o que ainda não existe; nunca sobrescreve confirmação humana.
    if (input.companyName && !hasValue(leadState.company)) {
      leadState.company = { value: input.companyName, status: 'inferred' };
    }
    if (input.title && !hasValue(leadState.role)) {
      leadState.role = { value: input.title, status: 'inferred' };
    }
    const newMemory = {
      ...memory,
      lead_state: leadState,
      apollo: { ...record(memory.apollo), ...apolloMeta },
      ...(conflict
        ? { identity_conflict: { other_contact_id: conflict.id, detected_at: new Date().toISOString(), note: 'E-mail e telefone apontam para contatos diferentes — revisar fusão.' } }
        : {}),
    };
    const tags = Array.from(new Set([...(existing.tags ?? []), ...baseTags, ...(conflict ? ['identity_conflict'] : [])]));
    const update: Record<string, unknown> = { tags, client_memory: newMemory };
    if (email && !existing.email) update.email = email;
    if (phone && !existing.phone_number) update.phone_number = phone;
    if (input.fullName && !existing.name) update.name = input.fullName;
    if (input.firstName && !existing.call_name) update.call_name = input.firstName;

    const { error } = await service.from('contacts').update(update).eq('id', existing.id);
    if (error) {
      console.error('[lead-identity] update falhou', error.message ?? error);
      return existing.id; // o contato existe; a falha de enriquecimento não derruba o lead
    }
    return existing.id;
  }

  const leadStateSeed: Record<string, unknown> = {};
  if (input.companyName) leadStateSeed.company = { value: input.companyName, status: 'inferred' };
  if (input.title) leadStateSeed.role = { value: input.title, status: 'inferred' };

  const { data: created, error } = await service
    .from('contacts')
    .insert({
      email,
      phone_number: phone,
      name: input.fullName ?? null,
      call_name: input.firstName ?? null,
      tags: baseTags,
      notes: input.companyName ? `Lead ${origin} — ${input.companyName}` : `Lead ${origin}`,
      client_memory: { lead_state: leadStateSeed, apollo: apolloMeta },
    })
    .select('id')
    .single();
  if (error) {
    console.error('[lead-identity] insert falhou', error.message ?? error);
    return null;
  }
  return (created as { id: string }).id;
}
