// Pacote de passagem de bastão (Playbook Indústrias v2.2, Passo 6.4) + roteamento
// (Passo 6.3). Compila, a partir do que já está no CRM — `lead_state` preenchido pelo
// analyze-conversation, consentimento, dados do Apollo e resumo da conversa —, a ficha
// que o Fabiano recebe para entrar na reunião sem repetir as perguntas que a Lis já fez.
// É código puro (sem I/O): quem chama passa o contato + a conversa já carregados.

// deno-lint-ignore no-explicit-any
type Rec = Record<string, any>;

function record(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : {};
}

function fieldValue(raw: unknown): { value: string; status: string } | null {
  const f = record(raw);
  const value = typeof f.value === 'string' ? f.value.trim() : '';
  if (!value) return null;
  return { value, status: typeof f.status === 'string' ? f.status : 'inferred' };
}

export interface RouteResult {
  /** Linha de encaminhamento: SCALE, Curso de IA, Governança ou a definir. */
  linha: string;
  motivo: string;
}

// Passo 6.3. Ordem importa: governança (societário/sucessão) vence; depois curso
// (capacitar); depois SCALE (processos/automação); senão, o Fabiano decide.
const GOVERNANCA = /s[óo]cio|sucess[ãa]o|fam[íi]li|protocolo familiar|herdeir|conflito entre s[óo]cios|governanç|governanc/i;
const CURSO = /capacit|treinar|treinamento|\bcurso\b|aprender a usar|ensinar o time|formar o time|liderança aprend|time aprend/i;
const SCALE = /process|automa|\brpa\b|fechamento|compra|pagament|nota fiscal|concilia|invent[áa]rio|padroniz|document|planejamento|informaç/i;

export function routeLead(memory: unknown): RouteResult {
  const mem = record(memory);
  const leadState = record(mem.lead_state);
  const hay = [
    fieldValue(leadState.primary_pain)?.value,
    fieldValue(leadState.offering_interest)?.value,
    fieldValue(leadState.desired_outcome)?.value,
    typeof leadState.conversation_summary === 'string' ? leadState.conversation_summary : '',
  ].filter(Boolean).join(' · ');

  if (GOVERNANCA.test(hay)) return { linha: 'Governança', motivo: 'Sinais de conflito societário, sucessão ou protocolo familiar.' };
  if (CURSO.test(hay)) return { linha: 'Curso de IA', motivo: 'Necessidade de capacitar a liderança/o time em IA.' };
  if (SCALE.test(hay)) return { linha: 'SCALE (diagnóstico)', motivo: 'Dor em processos, informação ou automação.' };
  return { linha: 'A definir com o Fabiano', motivo: 'Direção ainda não clara; o Fabiano define na conversa.' };
}

export interface HandoffPackage {
  markdown: string;
  routing: RouteResult;
  fields: {
    empresa: string;
    nome: string;
    cargo: string;
    persona: string;
    dor: string | null;
    momento: string | null;
    papel: string | null;
    consentimento: string;
    resumo: string | null;
    score: number | null;
    canal: string;
  };
}

/** Monta o pacote de passagem (Passo 6.4) a partir do contato + conversa carregados. */
export function buildHandoffPackage(input: { contact: unknown; conversation: unknown; memory?: unknown }): HandoffPackage {
  const contact = record(input.contact);
  const conversation = record(input.conversation);
  const mem = record(input.memory ?? contact.client_memory);
  const apollo = record(mem.apollo);
  const leadState = record(mem.lead_state);
  const consent = record(mem.consent);

  const nome = (typeof contact.name === 'string' && contact.name.trim())
    || (typeof contact.call_name === 'string' && contact.call_name.trim()) || '—';
  const empresa = (typeof apollo.company === 'string' && apollo.company.trim())
    || fieldValue(leadState.company)?.value || '—';
  const cargo = (typeof apollo.title === 'string' && apollo.title.trim())
    || fieldValue(leadState.role)?.value || '—';
  const persona = typeof apollo.persona === 'string' && apollo.persona ? apollo.persona : '—';
  const score = typeof apollo.score === 'number' ? apollo.score : null;
  const canal = conversation.channel === 'email' ? 'E-mail' : 'WhatsApp';

  const dorF = fieldValue(leadState.primary_pain);
  const momentoF = fieldValue(leadState.urgency);
  const papelF = fieldValue(leadState.role);
  const resumo = typeof leadState.conversation_summary === 'string' && leadState.conversation_summary.trim()
    ? leadState.conversation_summary.trim() : null;

  const consentimento = consent.granted === true
    ? `Concedido${typeof consent.channel === 'string' && consent.channel ? ` (${consent.channel})` : ''}${typeof consent.at === 'string' ? ` em ${consent.at}` : ''}`
    : consent.granted === false ? 'Negado' : 'Não registrado';

  const routing = routeLead(mem);
  const mark = (f: { value: string; status: string } | null) => (f ? `${f.value}${f.status === 'confirmed' ? '' : ' (inferido)'}` : '—');

  const markdown = [
    `Ficha de passagem — ${nome}`,
    `Empresa: ${empresa}`,
    `Cargo: ${cargo}`,
    `Persona / Score: ${persona}${score !== null ? ` · ${score}` : ''}`,
    `Canal: ${canal}`,
    '',
    `Papel na decisão: ${mark(papelF)}`,
    `Dor (nas palavras do lead): ${mark(dorF)}`,
    `Momento: ${mark(momentoF)}`,
    `Consentimento: ${consentimento}`,
    ...(resumo ? [`Resumo: ${resumo}`] : []),
    '',
    `Encaminhamento sugerido: ${routing.linha} — ${routing.motivo}`,
    'O Fabiano conduz a conversa de até 30 min. Não repita as perguntas já respondidas acima.',
  ].join('\n');

  return {
    markdown,
    routing,
    fields: {
      empresa, nome, cargo, persona,
      dor: dorF?.value ?? null,
      momento: momentoF?.value ?? null,
      papel: papelF?.value ?? null,
      consentimento, resumo, score, canal,
    },
  };
}
