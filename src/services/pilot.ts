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
  abordados: number;     // pessoas com algum toque enviado (não conversas)
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

// ===== Lote (Passos 7.3 e 7.4): uma linha por contato em cadência =====

export type ReplyType = 'positiva' | 'neutra' | 'negativa' | 'indicacao' | 'descadastro';

export const REPLY_TYPE_LABEL: Record<ReplyType, string> = {
  positiva: 'Positiva',
  neutra: 'Neutra',
  negativa: 'Negativa',
  indicacao: 'Indicação',
  descadastro: 'Descadastro',
};

export const LOSS_REASONS = [
  'Sem resposta (fim da cadência)',
  'Sem interesse',
  'Não é o momento',
  'Já tem solução ou fornecedor',
  'Fora do perfil (ICP)',
  'Mudou de cargo ou empresa',
  'E-mail inválido (bounce)',
  'Descadastro',
  'Cliente ou ex-cliente',
  'Outro',
];

export type TouchState = 'pendente' | 'enviado' | 'entregue' | 'lido' | 'barrado' | 'bounce' | 'pulado' | 'cancelado';

export interface PilotTouch {
  step: number;
  canal: 'E-mail' | 'WhatsApp';
  state: TouchState;
  at: string | null;
  detail: string | null;
}

export interface PilotLoteRow {
  contactId: string;
  nome: string;
  empresa: string;
  cargo: string;
  persona: string;
  score: number | null;
  touches: PilotTouch[];
  entregue: boolean;
  respondeu: boolean;
  autorizacao: 'sim' | 'negada' | null;
  replyType: ReplyType | null;          // marcado no painel
  replyTypeSuggested: ReplyType | null; // inferido (opt-out, autorização, reunião)
  reuniao: string | null;
  qualificada: boolean;
  lossReason: string | null;
  lossReasonSuggested: string | null;
  optOut: boolean;
  optOutReason: string | null;
  bounced: boolean;
  respondeuEm: string | null;
  canalResposta: string | null;
}

export interface PilotIndicator {
  label: string;
  value: string;
  detail: string;
  reference: string;
  alert: boolean;
}

export interface PilotLote {
  rows: PilotLoteRow[];
  indicators: PilotIndicator[];
}

export interface PilotCampaignReply {
  at: string;
  canal: 'E-mail' | 'WhatsApp';
}

export interface PilotOutsideContact {
  contactId: string;
  nome: string;
  detalhe: string;
  respondeu: boolean;
}

export interface PilotCampaign {
  lote: PilotLote;
  conversationOf: Record<string, string>;
  replies: PilotCampaignReply[];
  foraDoLote: PilotOutsideContact[];
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const pct = (part: number, total: number): string =>
  total > 0 ? `${((part / total) * 100).toFixed(1).replace('.', ',')}%` : '—';

const WA_STATE: Record<string, TouchState> = {
  delivered: 'entregue',
  read: 'lido',
  failed: 'barrado',
  sent: 'enviado',
  processing: 'enviado',
};

function touchFrom(step: any, bouncedAt: string | null, bounceStep: number | null): PilotTouch {
  const canal = step.channel === 'email' ? 'E-mail' : 'WhatsApp';
  const base = { step: step.step as number, canal, detail: null } as const;
  if (step.status === 'pending' || step.status === 'sending') return { ...base, state: 'pendente', at: step.scheduled_at };
  if (step.status === 'cancelled') return { ...base, state: 'cancelado', at: null, detail: step.last_error };
  if (step.status === 'skipped') return { ...base, state: 'pulado', at: null, detail: step.last_error };
  if (step.channel === 'email') {
    if (bouncedAt && bounceStep === step.step) return { ...base, state: 'bounce', at: step.sent_at };
    return { ...base, state: 'enviado', at: step.sent_at };
  }
  const message = record(step.message);
  const state = WA_STATE[String(message.status)] ?? 'enviado';
  const error = record(record(message.metadata).whatsapp_error);
  const detail = state === 'barrado'
    ? `Barrado pela Meta${error.code ? ` (${error.code})` : ''}${step.attempts > 1 ? ' — após nova tentativa' : ''}`
    : null;
  return { ...base, state, at: step.sent_at, detail };
}

function suggestReplyType(tags: string[], memory: Record<string, unknown>, hasMeeting: boolean): ReplyType | null {
  if (tags.includes('opt_out') || memory.opt_out === true) return 'descadastro';
  if (hasMeeting || record(memory.consent).granted === true) return 'positiva';
  return null;
}

function hasField(leadState: Record<string, unknown>, key: string): boolean {
  const field = record(leadState[key]);
  return typeof field.value === 'string' && field.value.trim() !== '';
}

export const pilotApi = {
  fetchLote: async (): Promise<PilotLote> => {
    const { data: steps, error } = await supabase
      .from('cadence_state')
      .select('contact_id, step, channel, status, sent_at, scheduled_at, last_error, attempts, message:messages(status, metadata)')
      .order('step')
      .limit(5000);
    if (error) throw error;

    const byContact = new Map<string, any[]>();
    for (const s of (steps ?? []) as any[]) {
      const list = byContact.get(s.contact_id) ?? [];
      list.push(s);
      byContact.set(s.contact_id, list);
    }
    const ids = [...byContact.keys()];

    const contacts: any[] = [];
    const appointments: any[] = [];
    const outcomes: any[] = [];
    for (const part of chunk(ids, 100)) {
      const [c, a, o] = await Promise.all([
        supabase.from('contacts').select('id, name, call_name, email, phone_number, tags, client_memory').in('id', part),
        supabase.from('appointments').select('contact_id, date, time').in('contact_id', part),
        supabase.from('lead_outcomes').select('contact_id, reply_type, loss_reason').in('contact_id', part),
      ]);
      contacts.push(...(c.data ?? []));
      appointments.push(...(a.data ?? []));
      outcomes.push(...(o.data ?? []));
    }
    const meetingOf = new Map<string, string>();
    for (const a of appointments) {
      const label = `${String(a.date).split('-').reverse().slice(0, 2).join('/')} ${String(a.time).slice(0, 5)}`;
      if (a.contact_id && !meetingOf.has(a.contact_id)) meetingOf.set(a.contact_id, label);
    }
    const outcomeOf = new Map<string, any>(outcomes.map((o) => [o.contact_id, o]));

    const rows: PilotLoteRow[] = contacts.map((contact) => {
      const memory = record(contact.client_memory);
      const apollo = record(memory.apollo);
      const leadState = record(memory.lead_state);
      const tags: string[] = Array.isArray(contact.tags) ? contact.tags : [];
      const contactSteps = (byContact.get(contact.id) ?? []).sort((x, y) => x.step - y.step);

      // Bounce: marca o último e-mail enviado antes do aviso de bounce.
      const bouncedAt = typeof memory.email_bounced_at === 'string' ? memory.email_bounced_at : null;
      const bounceStep = bouncedAt
        ? contactSteps
          .filter((s) => s.channel === 'email' && s.status === 'sent' && s.sent_at && s.sent_at <= bouncedAt)
          .map((s) => s.step as number).pop() ?? null
        : null;
      const touches = contactSteps.map((s) => touchFrom(s, bouncedAt, bounceStep));

      const consent = record(memory.consent);
      const respondeu = tags.includes('replied') || Boolean(memory.replied_at);
      const reuniao = meetingOf.get(contact.id) ?? null;
      const score = typeof apollo.score === 'number' ? apollo.score : null;
      const autorizacao: PilotLoteRow['autorizacao'] = consent.granted === true ? 'sim' : consent.granted === false ? 'negada' : null;
      // Passo 6.2: decide/influencia, dor registrada, autorização registrada e dentro do ICP.
      const qualificada = Boolean(reuniao) && autorizacao === 'sim'
        && hasField(leadState, 'role') && hasField(leadState, 'primary_pain') && (score === null || score >= 60);

      const optOut = tags.includes('opt_out') || memory.opt_out === true;
      const finished = contactSteps.length > 0 && contactSteps.every((s) => s.status !== 'pending' && s.status !== 'sending');
      const lossReasonSuggested = optOut ? 'Descadastro'
        : bouncedAt ? 'E-mail inválido (bounce)'
        : finished && !respondeu && !reuniao ? 'Sem resposta (fim da cadência)'
        : null;

      const outcome = outcomeOf.get(contact.id);
      return {
        contactId: contact.id,
        nome: nomeOf(contact),
        empresa: empresaOf(memory),
        cargo: (typeof apollo.title === 'string' && apollo.title.trim()) || '—',
        persona: typeof apollo.persona === 'string' ? apollo.persona : (tags.find((t) => t === 'P1' || t === 'P3') || '—'),
        score,
        touches,
        entregue: touches.some((t) => t.state === 'entregue' || t.state === 'lido' || (t.canal === 'E-mail' && t.state === 'enviado')),
        respondeu,
        autorizacao,
        replyType: (outcome?.reply_type as ReplyType | null) ?? null,
        replyTypeSuggested: suggestReplyType(tags, memory, Boolean(reuniao)),
        reuniao,
        qualificada,
        lossReason: outcome?.loss_reason ?? null,
        lossReasonSuggested,
        optOut,
        optOutReason: typeof memory.opt_out_reason === 'string' && memory.opt_out_reason.trim() ? memory.opt_out_reason.trim() : null,
        bounced: Boolean(bouncedAt),
        respondeuEm: typeof memory.replied_at === 'string' ? memory.replied_at : null,
        canalResposta: typeof memory.last_reply_channel === 'string' ? memory.last_reply_channel : null,
      };
    }).sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'));

    // Indicadores do Passo 7.4 sobre o lote (contatos com cadência).
    const total = rows.length;
    const emailed = rows.filter((r) => r.touches.some((t) => t.canal === 'E-mail' && (t.state === 'enviado' || t.state === 'bounce'))).length;
    const bounced = rows.filter((r) => r.touches.some((t) => t.state === 'bounce')).length;
    const replied = rows.filter((r) => r.respondeu).length;
    const typeOf = (r: PilotLoteRow) => r.replyType ?? r.replyTypeSuggested;
    const positive = rows.filter((r) => typeOf(r) === 'positiva').length;
    const consented = rows.filter((r) => r.respondeu && r.autorizacao === 'sim').length;
    const optOuts = rows.filter((r) => typeOf(r) === 'descadastro').length;
    const qualified = rows.filter((r) => r.qualificada).length;
    const waTouches = rows.flatMap((r) => r.touches.filter((t) => t.canal === 'WhatsApp' && ['enviado', 'entregue', 'lido', 'barrado'].includes(t.state)));
    const waDelivered = waTouches.filter((t) => t.state === 'entregue' || t.state === 'lido').length;

    const indicators: PilotIndicator[] = [
      { label: 'Bounce', value: pct(bounced, emailed), detail: `${bounced} de ${emailed} com e-mail enviado`, reference: 'Abaixo de 3%', alert: emailed > 0 && bounced / emailed > 0.03 },
      { label: 'Resposta total', value: pct(replied, total), detail: `${replied} de ${total}`, reference: 'Mercado: 3 a 8% (varia por setor)', alert: false },
      { label: 'Resposta positiva', value: pct(positive, total), detail: `${positive} de ${total}`, reference: 'Costuma ficar entre 1 e 3%', alert: false },
      { label: 'Autorização entre quem respondeu', value: pct(consented, replied), detail: `${consented} de ${replied}`, reference: 'Sem referência: medir no lote 1', alert: false },
      { label: 'Descadastro ou reclamação', value: pct(optOuts, total), detail: `${optOuts} de ${total}`, reference: 'Abaixo de 1 a 2% (acima disso, pare o lote)', alert: total > 0 && optOuts / total > 0.02 },
      { label: 'Reunião qualificada por 100 contatos', value: total > 0 ? ((qualified / total) * 100).toFixed(1).replace('.', ',') : '—', detail: `${qualified} reunião(ões) qualificada(s)`, reference: 'Meta definida após o lote 1', alert: false },
      { label: 'WhatsApp entregue', value: pct(waDelivered, waTouches.length), detail: `${waDelivered} de ${waTouches.length} toques`, reference: 'Barrados pela Meta ganham uma nova tentativa', alert: false },
    ];

    return { rows, indicators };
  },

  // Dashboard da campanha: o lote + a conversa de cada lead (para abrir no chat),
  // as respostas dos leads nos últimos 30 dias e quem está fora do lote (testes
  // internos e contatos diretos), que não entra nos números.
  fetchCampaign: async (): Promise<PilotCampaign> => {
    const lote = await pilotApi.fetchLote();
    const loteIds = new Set(lote.rows.map((r) => r.contactId));

    const { data: allContacts, error: contactsError } = await supabase
      .from('contacts')
      .select('id, name, call_name, email, phone_number, tags')
      .limit(5000);
    if (contactsError) throw contactsError;
    const outside = (allContacts ?? []).filter((c) => !loteIds.has(c.id));

    const conversations: any[] = [];
    for (const part of chunk([...loteIds, ...outside.map((c) => c.id)], 100)) {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, contact_id, channel, last_message_at')
        .in('contact_id', part);
      if (error) throw error;
      conversations.push(...(data ?? []));
    }
    // Conversa mais recente de cada contato é a que o chat abre.
    const conversationOf: Record<string, string> = {};
    const lastAt: Record<string, string> = {};
    for (const c of conversations) {
      const at = c.last_message_at ?? '';
      if (!conversationOf[c.contact_id] || at > lastAt[c.contact_id]) {
        conversationOf[c.contact_id] = c.id;
        lastAt[c.contact_id] = at;
      }
    }

    const since = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const loteConversations = conversations.filter((c) => loteIds.has(c.contact_id));
    const channelOf = new Map<string, string>(loteConversations.map((c) => [c.id, c.channel]));
    const replies: PilotCampaignReply[] = [];
    for (const part of chunk(loteConversations.map((c) => c.id), 100)) {
      const { data, error } = await supabase
        .from('messages')
        .select('created_at, conversation_id')
        .eq('from_type', 'user')
        .gte('created_at', since)
        .in('conversation_id', part)
        .limit(5000);
      if (error) throw error;
      for (const m of data ?? []) {
        replies.push({ at: m.created_at, canal: channelOf.get(m.conversation_id) === 'email' ? 'E-mail' : 'WhatsApp' });
      }
    }

    return {
      lote,
      conversationOf,
      replies,
      foraDoLote: outside.map((c) => ({
        contactId: c.id,
        nome: nomeOf(c),
        detalhe: typeof c.email === 'string' && c.email.endsWith('@trajetoriaconsultoria.com.br')
          ? 'Teste interno (e-mail da Trajetória)'
          : (Array.isArray(c.tags) && c.tags.includes('apollo') ? 'Lead do Apollo sem cadência' : 'Teste interno ou contato direto, sem cadência'),
        respondeu: Array.isArray(c.tags) && c.tags.includes('replied'),
      })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    };
  },

  saveOutcome: async (contactId: string, patch: { reply_type?: ReplyType | null; loss_reason?: string | null }): Promise<void> => {
    const { error } = await supabase
      .from('lead_outcomes')
      .upsert({ contact_id: contactId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'contact_id' });
    if (error) throw error;
  },

  fetchOverview: async (): Promise<PilotOverview> => {
    // Contagens do funil — baratas (head:true).
    const [captados, reunioes, escaladasCount, responderam] = await Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true }),
      supabase.from('appointments').select('id', { count: 'exact', head: true }),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'human'),
      supabase.from('contacts').select('id', { count: 'exact', head: true }).contains('tags', ['replied']),
    ]);

    // Em cadência: contatos distintos com step pendente/em envio. Abordados:
    // contatos distintos com algum toque enviado (pessoas, não conversas — cada
    // lead tem uma conversa por canal). Tolerante à tabela ainda não existir
    // (pré-migração) — vira 0 e cadenceAvailable=false.
    let emCadencia = 0;
    let abordados = 0;
    let cadenceAvailable = true;
    {
      const { data, error } = await supabase
        .from('cadence_state')
        .select('contact_id, status')
        .in('status', ['pending', 'sending', 'sent'])
        .limit(5000);
      if (error) {
        cadenceAvailable = false;
      } else {
        const rows = (data ?? []) as Array<{ contact_id: string; status: string }>;
        emCadencia = new Set(rows.filter((r) => r.status !== 'sent').map((r) => r.contact_id)).size;
        abordados = new Set(rows.filter((r) => r.status === 'sent').map((r) => r.contact_id)).size;
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
        abordados,
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
