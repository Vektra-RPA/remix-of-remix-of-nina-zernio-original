// Triagem dos leads do Apollo (23/11/2026) — a mesma revisão feita à mão no lote 2,
// agora automática: depois que o lead passa pelo filtro do apollo.ts e pela nota do
// playbook, o Claude lê os dados da empresa e do cargo e decide OK / DÚVIDA / FORA.
// Só OK entra na sequência. DÚVIDA fica parada esperando uma pessoa decidir. FORA é
// desqualificado. Critérios: e-mail do Fabiano de 18/11 + padrões achados na revisão
// manual dos 241 leads do lote 2 (22-23/11).

import { callChatWithFallback, LLM_CATALOG } from './llm.ts';

export type TriageVerdict = 'OK' | 'DUVIDA' | 'FORA';

export interface TriageResult {
  id: string;
  veredito: TriageVerdict;
  persona: 'P1' | 'P3' | null;
  motivo: string;
}

/** Linha de apollo_leads com o que a triagem usa (raw.person traz a empresa e o histórico). */
export interface TriageLead {
  id: string;
  full_name: string | null;
  title: string | null;
  seniority: string | null;
  email: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  company_employees: number | null;
  company_city: string | null;
  company_state: string | null;
  city: string | null;
  state: string | null;
  raw: Record<string, unknown> | null;
}

// Tags do contato durante a triagem.
export const TAG_PENDING = 'triagem_pendente';
export const TAG_DOUBT = 'triagem_duvida';
export const TAG_OUT = 'desqualificado_triagem';

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function clip(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Resumo compacto do lead para o modelo (sem telefone nem LinkedIn: não ajudam a decidir). */
export function triageInput(lead: TriageLead): Record<string, unknown> {
  const person = rec(rec(lead.raw).person);
  const org = rec(person.organization);
  const history = Array.isArray(person.employment_history) ? person.employment_history : [];
  const current = history
    .map(rec)
    .filter((h) => h.current === true || h.current === 'true')
    .slice(0, 4)
    .map((h) => ({ empresa: h.organization_name ?? null, cargo: h.title ?? null, inicio: h.start_date ?? null }));
  const keywords = Array.isArray(org.keywords) ? (org.keywords as unknown[]).filter((k) => typeof k === 'string').slice(0, 25) : [];
  return {
    id: lead.id,
    nome: lead.full_name,
    cargo: lead.title,
    senioridade: lead.seniority,
    email_dominio: lead.email && lead.email.includes('@') ? lead.email.split('@')[1].toLowerCase() : null,
    email_usuario: lead.email && lead.email.includes('@') ? lead.email.split('@')[0].toLowerCase() : null,
    empresa: lead.company_name,
    site: lead.company_domain,
    setor_apollo: lead.company_industry,
    funcionarios: lead.company_employees,
    cidade: lead.company_city ?? lead.city,
    estado: lead.company_state ?? lead.state,
    fundada: org.founded_year ?? null,
    descricao: clip(org.short_description, 900),
    descricao_seo: clip(org.seo_description, 300),
    palavras_chave: keywords,
    cargos_atuais: current,
  };
}

const SYSTEM = `Você faz a triagem de leads para a prospecção da Trajetória Consultoria (Curitiba).
O Fabiano (sócio) vai abordar por e-mail donos e diretores financeiros de indústrias de médio porte. Sua tarefa é dizer, para cada lead, se vale a pena abordar.

PERFIL QUE VALE (veredito OK):
- Indústria de transformação com produção própria no Brasil (fabrica, produz, usina, injeta, extrude, estampa, funde, monta o próprio produto). Ex.: metalmecânica, máquinas e equipamentos, plásticos, embalagens, química, cosméticos com fábrica própria, alimentos industrializados, têxtil, autopeças, papel.
- Médio porte: cerca de 50 a 500 funcionários.
- Sede/operação no PR, SC, RS ou SP.
- Controle brasileiro (não é subsidiária de grupo estrangeiro nem marca de grande grupo nacional).
- Contato com cargo atual na empresa de P1 (dono, sócio, fundador, CEO, presidente, diretor-presidente) ou P3 (diretor financeiro, CFO, diretor administrativo-financeiro, controller com nível de diretoria).
- E-mail no domínio da própria empresa (ou de marca/razão social claramente da mesma empresa) e com cara de ser da própria pessoa.

FORA (não abordar):
- Não fabrica: distribuidor, revenda, importador, representação comercial, comércio, varejo, e-commerce, rede de lojas/franquias, food service, cafeteria.
- Serviço como atividade principal: manutenção, instalação, assistência técnica, engenharia de projetos/EPC, consultoria, assessoria, locação, laudos.
- Saúde (clínica, estética, distribuição hospitalar), agro primário (granja, avicultura, cultivo), faculdade/escola, logística, construtora, TI/software, associação, sindicato, federação.
- Holding ou marca sem fábrica própria (produção terceirizada).
- Subsidiária ou controlada de grupo estrangeiro; multinacional; marca de grande grupo nacional.
- Fora de PR/SC/RS/SP.
- Cargo comercial, industrial, de operações, de TI ou de RH (mesmo sendo diretor).
- E-mail genérico (contato@, comercial@...) ou de outra empresa; CFO terceirizado ("CFO as a service").
- Dados contraditórios (descrição de outra empresa, cargo atual já ocupado por outra pessoa).

DÚVIDA (uma pessoa decide):
- Sinais mistos: fabrica, mas o negócio parece ser instalação/integração/serviço; marca de cosméticos/perfumes/suplementos que pode terceirizar a produção; possível controle estrangeiro sem confirmação; porte possivelmente acima de 500; cargo ambíguo (diretor administrativo sem "financeiro", diretor executivo que pode não ser o principal).
- Use DÚVIDA só quando houver um ponto concreto a confirmar. Cargo atual sem data de início, sozinho, não é motivo de dúvida.

REGRAS:
- Decida com o que está nos dados; não invente fatos sobre a empresa.
- persona: P1 (dono/sócio/CEO/presidente) ou P3 (financeiro); null quando FORA por cargo.
- motivo: uma frase curta em português, no formato "Indústria: <o que fabrica> | <cargo>" para OK, e o ponto principal para DÚVIDA ou FORA (ex.: "Distribuidor de peças, não fabrica"; "Subsidiária de grupo alemão"; "Fabrica elevadores, mas o core parece instalação e manutenção | confirmar").
- Responda chamando a ferramenta registrar_triagem uma única vez, com um item para CADA lead recebido, usando o id exato.`;

const TOOL = {
  type: 'function',
  function: {
    name: 'registrar_triagem',
    description: 'Registra o veredito da triagem de cada lead recebido.',
    parameters: {
      type: 'object',
      properties: {
        leads: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'id exato do lead recebido' },
              veredito: { type: 'string', enum: ['OK', 'DUVIDA', 'FORA'] },
              persona: { type: ['string', 'null'], enum: ['P1', 'P3', null] },
              motivo: { type: 'string', description: 'frase curta em português' },
            },
            required: ['id', 'veredito', 'persona', 'motivo'],
          },
        },
      },
      required: ['leads'],
    },
  },
};

/**
 * Faz a triagem de um lote pequeno de leads (até ~10 por chamada). Devolve só os
 * vereditos válidos; lead que o modelo não devolveu fica de fora (a chamada seguinte
 * tenta de novo). Erro do provedor propaga.
 */
export async function triageBatch(leads: TriageLead[]): Promise<TriageResult[]> {
  if (leads.length === 0) return [];
  const payload = leads.map(triageInput);
  const result = await callChatWithFallback({
    provider: 'anthropic',
    model: LLM_CATALOG.anthropic.tierDefault.medium,
    apiKeys: { lovable: '' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Leads para triagem (JSON):\n${JSON.stringify(payload)}` },
    ],
    tools: [TOOL],
    temperature: 0,
    maxTokens: 3000,
    toolChoice: 'auto',
  });
  const call = result.toolCalls.find((c) => c.function.name === 'registrar_triagem');
  if (!call) throw new Error('triagem: o modelo não chamou registrar_triagem');
  let parsed: unknown;
  try { parsed = JSON.parse(call.function.arguments); } catch { throw new Error('triagem: resposta inválida'); }
  const items = Array.isArray(rec(parsed).leads) ? rec(parsed).leads as unknown[] : [];
  const ids = new Set(leads.map((l) => l.id));
  const out: TriageResult[] = [];
  for (const raw of items) {
    const it = rec(raw);
    const id = typeof it.id === 'string' ? it.id : '';
    const v = it.veredito;
    if (!ids.has(id) || (v !== 'OK' && v !== 'DUVIDA' && v !== 'FORA')) continue;
    const persona = it.persona === 'P1' || it.persona === 'P3' ? it.persona : null;
    const motivo = typeof it.motivo === 'string' && it.motivo.trim() ? it.motivo.trim().slice(0, 300) : '(sem motivo)';
    out.push({ id, veredito: v, persona, motivo });
    ids.delete(id);
  }
  return out;
}
