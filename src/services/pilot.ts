import { supabase } from '@/integrations/supabase/client';

// Painel do piloto (Épico H — Passos 7.3/7.4 do playbook). Lê o estado que já
// existe no banco (contatos, conversas, agendamentos, cadência) e monta o funil
// + a lista de escaladas aguardando atendimento humano. Tudo pela chave do
// usuário autenticado (RLS). A cadência depende da migração 20261005; se a tabela
// ainda não existe (pré-deploy), o painel degrada com `cadenceAvailable=false`.

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export interface PilotFunnel {
  captados: number;      // contatos na base
  emCadencia: number;    // contatos com toque agendado
  abordados: number;     // conversas iniciadas (a Lis já falou)
  responderam: number;   // contatos com resposta registrada
  reunioes: number;      // agendamentos criados
  escaladas: number;     // conversas em atendimento humano
}

export interface PilotEscalation {
  conversationId: string;
  nome: string;
  empresa: string;
  canal: string;
  motivo: string;
  resumo: string;
  contato: string;
  routing: string | null;
  requestedAt: string | null;
  alerted: boolean;
}

export interface PilotLeadRow {
  conversationId: string;
  nome: string;
  empresa: string;
  persona: string;
  score: number | null;
  canal: string;
  statusLabel: string;
  ultimaAtividade: string | null;
}

export interface PilotOverview {
  funnel: PilotFunnel;
  escalations: PilotEscalation[];
  leads: PilotLeadRow[];
  cadenceAvailable: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  nina: 'Com a Lis',
  human: 'Atendimento humano',
  paused: 'Pausado',
};

function empresaOf(memory: Record<string, unknown>): string {
  const apollo = record(memory.apollo);
  if (typeof apollo.company === 'string' && apollo.company.trim()) return apollo.company.trim();
  const leadState = record(memory.lead_state);
  const company = record(leadState.company);
  if (typeof company.value === 'string' && company.value.trim()) return company.value.trim();
  return '—';
}

function nomeOf(contact: Record<string, unknown>): string {
  return (
    (typeof contact.name === 'string' && contact.name.trim()) ||
    (typeof contact.call_name === 'string' && contact.call_name.trim()) ||
    (typeof contact.phone_number === 'string' && contact.phone_number) ||
    (typeof contact.email === 'string' && contact.email) ||
    'Lead sem nome'
  );
}

function statusLabelFor(convStatus: string, tags: string[]): string {
  if (tags.includes('opt_out')) return 'Opt-out';
  if (convStatus === 'nina' && tags.includes('replied')) return 'Respondeu';
  return STATUS_LABEL[convStatus] || convStatus;
}

export const pilotApi = {
  fetchOverview: async (): Promise<PilotOverview> => {
    // Contagens do funil — baratas (head:true).
    const [captados, reunioes, abordados, escaladasCount, responderam] = await Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true }),
      supabase.from('appointments').select('id', { count: 'exact', head: true }),
      supabase.from('conversations').select('id', { count: 'exact', head: true }),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'human'),
      supabase.from('contacts').select('id', { count: 'exact', head: true }).contains('tags', ['replied']),
    ]);

    // Em cadência: contatos distintos com step pendente/em envio. Tolerante à
    // tabela ainda não existir (pré-migração) — vira 0 e cadenceAvailable=false.
    let emCadencia = 0;
    let cadenceAvailable = true;
    {
      const { data, error } = await supabase
        .from('cadence_state')
        .select('contact_id')
        .in('status', ['pending', 'sending'])
        .limit(5000);
      if (error) {
        cadenceAvailable = false;
      } else {
        emCadencia = new Set((data ?? []).map((r: { contact_id: string }) => r.contact_id)).size;
      }
    }

    // Escaladas aguardando humano (lista acionável do Passo 7.3).
    const { data: humanConvs } = await supabase
      .from('conversations')
      .select('id, channel, status, metadata, last_message_at, contact:contacts(name, call_name, phone_number, email, client_memory)')
      .eq('status', 'human')
      .order('last_message_at', { ascending: false })
      .limit(50);

    const escalations: PilotEscalation[] = (humanConvs ?? []).map((conv: any) => {
      const meta = record(conv.metadata);
      const handoff = record(meta.handoff);
      const escalation = record(meta.escalation);
      const routing = record(handoff.routing);
      const contact = record(conv.contact);
      const memory = record(contact.client_memory);
      return {
        conversationId: conv.id,
        nome: nomeOf(contact),
        empresa: empresaOf(memory),
        canal: conv.channel === 'email' ? 'E-mail' : 'WhatsApp',
        motivo: (typeof handoff.reason === 'string' && handoff.reason) || '—',
        resumo: (typeof handoff.summary === 'string' && handoff.summary) || '—',
        contato: [contact.phone_number, contact.email].filter(Boolean).join(' · ') || '—',
        routing: (typeof routing.linha === 'string' && routing.linha) || null,
        requestedAt: (typeof handoff.requested_at === 'string' && handoff.requested_at) || conv.last_message_at || null,
        alerted: Boolean(escalation.alerted_at),
      };
    });

    // Leads recentes (conversas ativas) — visão por lead com persona/score/estado.
    const { data: activeConvs } = await supabase
      .from('conversations')
      .select('id, channel, status, last_message_at, contact:contacts(name, call_name, phone_number, email, tags, client_memory)')
      .eq('is_active', true)
      .order('last_message_at', { ascending: false })
      .limit(60);

    const leads: PilotLeadRow[] = (activeConvs ?? []).map((conv: any) => {
      const contact = record(conv.contact);
      const memory = record(contact.client_memory);
      const apollo = record(memory.apollo);
      const tags: string[] = Array.isArray(contact.tags) ? contact.tags : [];
      const persona = typeof apollo.persona === 'string' ? apollo.persona : (tags.find((t) => t === 'P1' || t === 'P3') || '—');
      const score = typeof apollo.score === 'number' ? apollo.score : null;
      return {
        conversationId: conv.id,
        nome: nomeOf(contact),
        empresa: empresaOf(memory),
        persona,
        score,
        canal: conv.channel === 'email' ? 'E-mail' : 'WhatsApp',
        statusLabel: statusLabelFor(conv.status, tags),
        ultimaAtividade: conv.last_message_at || null,
      };
    });

    return {
      funnel: {
        captados: captados.count ?? 0,
        emCadencia,
        abordados: abordados.count ?? 0,
        responderam: responderam.count ?? 0,
        reunioes: reunioes.count ?? 0,
        escaladas: escaladasCount.count ?? 0,
      },
      escalations,
      leads,
      cadenceAvailable,
    };
  },
};
