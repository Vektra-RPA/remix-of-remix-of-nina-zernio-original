/**
 * Acesso à Apollo.io pelo connector gateway da Lovable.
 * Nunca chamar api.apollo.io direto: o gateway injeta a chave real.
 */

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/apollo';

export class ApolloError extends Error {
  constructor(public status: number, public body: string) {
    super(`Apollo [${status}]: ${body}`);
  }
  /** 401/403 são terminais: parar o job e pedir ação do dono. */
  get terminal(): boolean {
    return this.status === 401 || this.status === 402 || this.status === 403;
  }
}

function headers(): Record<string, string> {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const apolloKey = Deno.env.get('APOLLO_API_KEY');
  if (!lovableKey) throw new Error('LOVABLE_API_KEY não configurada');
  if (!apolloKey) throw new Error('APOLLO_API_KEY não configurada');
  return { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': apolloKey };
}

function buildUrl(path: string, params: Record<string, string | string[] | undefined>): string {
  const url = new URL(`${GATEWAY_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(`${key}[]`, item);
    } else {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

// deno-lint-ignore no-explicit-any
async function apolloPost(path: string, params: Record<string, any>): Promise<any> {
  const response = await fetch(buildUrl(path, params), { method: 'POST', headers: headers() });
  if (!response.ok) throw new ApolloError(response.status, await response.text());
  return await response.json();
}

export interface ApolloSearchCriteria {
  titles: string[];
  locations: string[];
  industries: string[];
  employeesMin: number;
  employeesMax: number;
}

export interface ApolloSearchPerson {
  id: string;
  title?: string | null;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export async function searchPeople(
  criteria: ApolloSearchCriteria,
  page: number,
  perPage = 25,
): Promise<{ total: number; people: ApolloSearchPerson[] }> {
  const data = await apolloPost('/api/v1/mixed_people/api_search', {
    person_titles: criteria.titles,
    person_locations: criteria.locations,
    q_organization_keyword_tags: criteria.industries,
    organization_num_employees_ranges: [`${criteria.employeesMin},${criteria.employeesMax}`],
    per_page: String(perPage),
    page: String(page),
  });
  return { total: Number(data?.total_entries ?? 0), people: Array.isArray(data?.people) ? data.people : [] };
}

// deno-lint-ignore no-explicit-any
export async function matchPerson(id: string, webhookUrl?: string): Promise<any> {
  const data = await apolloPost('/api/v1/people/match', {
    id,
    ...(webhookUrl ? { reveal_phone_number: 'true', webhook_url: webhookUrl } : {}),
  });
  return data?.person ?? null;
}

/** Normaliza para o formato E.164 brasileiro (só celular vale para WhatsApp). */
export function normalizeBrazilMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  if (!digits.startsWith('55') || digits.length < 12 || digits.length > 13) return null;
  const national = digits.slice(2);
  if (national.length === 11 && national[2] === '9') return digits;
  if (national.length === 10) return null; // fixo — não serve para WhatsApp
  return null;
}

// deno-lint-ignore no-explicit-any
export function extractPhone(person: any): string | null {
  const candidates: string[] = [];
  for (const entry of person?.phone_numbers ?? []) {
    if (entry?.sanitized_number) candidates.push(entry.sanitized_number);
    else if (entry?.raw_number) candidates.push(entry.raw_number);
  }
  if (person?.mobile_phone) candidates.push(person.mobile_phone);
  if (person?.sanitized_phone) candidates.push(person.sanitized_phone);
  for (const candidate of candidates) {
    const normalized = normalizeBrazilMobile(candidate);
    if (normalized) return normalized;
  }
  return null;
}

const SENIOR_TITLES = ['ceo', 'chief executive', 'presidente', 'owner', 'founder', 'sócio', 'socio', 'proprietário'];

/** Prioridade 0–100: cargo, porte da empresa e qualidade do contato. */
// deno-lint-ignore no-explicit-any
export function scoreLead(person: any, phone: string | null): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 30;
  const title = String(person?.title ?? '').toLowerCase();
  if (SENIOR_TITLES.some((word) => title.includes(word))) {
    score += 25;
    reasons.push('Cargo de decisão máxima');
  } else if (title.includes('diretor') || title.includes('director')) {
    score += 15;
    reasons.push('Cargo de diretoria');
  }
  const employees = Number(person?.organization?.estimated_num_employees ?? 0);
  if (employees >= 200) {
    score += 20;
    reasons.push('Empresa de grande porte');
  } else if (employees >= 100) {
    score += 12;
    reasons.push('Empresa de porte médio');
  } else if (employees >= 50) {
    score += 8;
    reasons.push('Empresa dentro da faixa alvo');
  }
  if (phone) {
    score += 20;
    reasons.push('Celular disponível para WhatsApp');
  }
  if (person?.email && person?.email_status === 'verified') {
    score += 10;
    reasons.push('E-mail verificado');
  }
  return { score: Math.min(100, score), reasons };
}
