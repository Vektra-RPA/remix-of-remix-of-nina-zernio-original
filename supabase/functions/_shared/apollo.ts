/**
 * Acesso à Apollo.io. No Lovable Cloud passa pelo connector gateway da Lovable
 * (que injeta a chave real); no Supabase próprio — sem LOVABLE_API_KEY — chama a
 * api.apollo.io direto, autenticando com APOLLO_API_KEY no header X-Api-Key.
 */

import { derivePersona, type Persona } from './lead-identity.ts';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/apollo';
const APOLLO_DIRECT_URL = 'https://api.apollo.io';

function apolloBaseUrl(): string {
  return Deno.env.get('LOVABLE_API_KEY') ? GATEWAY_URL : APOLLO_DIRECT_URL;
}

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
  if (!apolloKey) throw new Error('APOLLO_API_KEY não configurada');
  if (lovableKey) return { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': apolloKey };
  return { 'X-Api-Key': apolloKey, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' };
}

function buildUrl(path: string, params: Record<string, string | string[] | undefined>): string {
  const url = new URL(`${apolloBaseUrl()}${path}`);
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

// ===== Score do playbook Indústrias v2.2 (Passo 1.4) — 0 a 100, corte ≥ 60 =====
// Cargo 0–40 · Porte 0–20 · Setor 0–15 · Sinais 0–15 · Região 0–10.
// Cargo fora de P1/P3 é exclusão automática (playbook: "outros = 0, excluir").

const PRIORITY_SECTOR_WORDS = [
  'metalmec', 'metalúrg', 'metalurg', 'metalworking', 'machinery', 'máquina',
  'maquina', 'mecânic', 'mecanic', 'fabricated metal',
  'cosmét', 'cosmet', 'cosmetic', 'beauty', 'personal care', 'perfum',
  'plástic', 'plastic', 'polymer', 'polímero', 'polimero',
];
const TRANSFORM_SECTOR_WORDS = [
  'manufactur', 'indústr', 'industr', 'production', 'produção', 'producao',
  'fábrica', 'fabrica', 'factory', 'aliment', 'food', 'beverage', 'bebida',
  'textil', 'textile', 'têxtil', 'químic', 'quimic', 'chemical', 'borracha',
  'rubber', 'metal', 'móveis', 'moveis', 'furniture', 'papel', 'paper',
  'embalagem', 'packaging', 'autopeç', 'auto part', 'componentes',
];
const ERP_WORDS = ['totvs', 'protheus', 'datasul', 'microsiga', 'senior sistemas', 'sankhya', 'sap', 's/4hana', 'oracle erp'];
const ISO_LEAN_WORDS = ['iso 9001', 'iso9001', 'iso 14001', 'lean', 'six sigma', 'seis sigma', 'kaizen', 'melhoria contínua', 'melhoria continua', 'continuous improvement', ' wcm'];
const HIRING_WORDS = ['compras', 'procurement', 'financeiro', 'controladoria', 'controller', 'supply chain', 'planejamento e controle'];
const FEDERATION_WORDS = ['ciesp', 'fiesp', 'fiep', 'fiesc', 'firjan', 'fieg', 'federação das indústrias', 'federacao das industrias'];

const SUL_STATES = ['pr', 'parana', 'paraná', 'sc', 'santa catarina', 'rs', 'rio grande do sul'];
const SP_STATES = ['sp', 'sao paulo', 'são paulo'];
const SP_CAPITAL = ['sao paulo', 'são paulo'];

function norm(value: unknown): string {
  return String(value ?? '').toLowerCase().trim();
}

/** Junta os textos da organização disponíveis para detectar setor e sinais. */
// deno-lint-ignore no-explicit-any
function collectOrgText(person: any): string {
  const org = person?.organization ?? {};
  const parts: unknown[] = [
    org.industry, org.name, org.short_description, org.seo_description,
    person?.title, person?.headline,
    ...(Array.isArray(org.keywords) ? org.keywords : []),
    ...(Array.isArray(org.technology_names) ? org.technology_names : []),
    ...(Array.isArray(org.industries) ? org.industries : []),
  ];
  return parts.map(norm).filter(Boolean).join(' · ');
}

function scorePorte(employees: number): { points: number; reason: string | null } {
  if (employees >= 100 && employees <= 300) return { points: 20, reason: 'Porte ideal (100–300 func.)' };
  if ((employees >= 50 && employees <= 99) || (employees >= 301 && employees <= 500)) {
    return { points: 12, reason: 'Porte na faixa (50–99 ou 301–500 func.)' };
  }
  return { points: 0, reason: null };
}

function scoreSetor(text: string): { points: number; reason: string | null } {
  if (PRIORITY_SECTOR_WORDS.some((w) => text.includes(w))) {
    return { points: 15, reason: 'Setor prioritário (metalmecânico/cosméticos/plásticos)' };
  }
  if (TRANSFORM_SECTOR_WORDS.some((w) => text.includes(w))) {
    return { points: 10, reason: 'Indústria de transformação' };
  }
  return { points: 0, reason: null };
}

function scoreSinais(text: string): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  if (ERP_WORDS.some((w) => text.includes(w))) reasons.push('ERP moderno');
  if (ISO_LEAN_WORDS.some((w) => text.includes(w))) reasons.push('ISO/Lean');
  if (HIRING_WORDS.some((w) => text.includes(w))) reasons.push('Sinal de compras/financeiro/melhoria');
  if (FEDERATION_WORDS.some((w) => text.includes(w))) reasons.push('Federação da indústria');
  const kept = reasons.slice(0, 3); // 5 pontos por sinal, máximo 15
  return { points: kept.length * 5, reasons: kept };
}

// deno-lint-ignore no-explicit-any
function scoreRegiao(person: any): { points: number; reason: string } {
  const state = norm(person?.state ?? person?.organization?.state);
  const city = norm(person?.city ?? person?.organization?.city);
  if (SUL_STATES.includes(state)) return { points: 10, reason: 'Região Sul' };
  if (SP_STATES.includes(state)) {
    if (SP_CAPITAL.includes(city)) return { points: 5, reason: 'SP (capital)' };
    // "Interior de SP" (10) só com cidade conhecida e fora da capital. Sem cidade
    // não dá para afirmar interior — crédito conservador (5), igual à capital, pra
    // não inflar o score de um lead que pode estar na Grande SP.
    if (city) return { points: 10, reason: 'Interior de SP' };
    return { points: 5, reason: 'SP (cidade não informada)' };
  }
  return { points: 5, reason: 'Fora da região prioritária' };
}

export interface LeadScore {
  score: number;
  reasons: string[];
  persona: Persona;
  /** Cargo P1/P3 E total ≥ 60. Cargo fora de P1/P3 nunca qualifica. */
  qualified: boolean;
}

/** Score 0–100 conforme o playbook Indústrias v2.2 (Passo 1.4). */
// deno-lint-ignore no-explicit-any
export function scoreLead(person: any): LeadScore {
  const persona = derivePersona(person?.title, person?.seniority);
  const text = collectOrgText(person);
  const employees = Number(person?.organization?.estimated_num_employees ?? 0);

  const cargoPoints = persona === 'P1' ? 40 : persona === 'P3' ? 35 : 0;
  const porte = scorePorte(employees);
  const setor = scoreSetor(text);
  const sinais = scoreSinais(text);
  const regiao = scoreRegiao(person);

  const reasons: string[] = [];
  if (persona === 'P1') reasons.push('Cargo P1 (dono/sócio/CEO) — 40');
  else if (persona === 'P3') reasons.push('Cargo P3 (diretor adm-financeiro) — 35');
  else reasons.push('Cargo fora de P1/P3 — exclusão');
  if (porte.reason) reasons.push(porte.reason);
  if (setor.reason) reasons.push(setor.reason);
  reasons.push(...sinais.reasons);
  reasons.push(regiao.reason);

  const score = Math.min(100, cargoPoints + porte.points + setor.points + sinais.points + regiao.points);
  const qualified = persona !== null && score >= 60;
  return { score, reasons, persona, qualified };
}
