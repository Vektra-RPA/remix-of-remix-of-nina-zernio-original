import type { PilotCampaignReply, PilotLoteRow, PilotTouch } from '../services/pilot';

// Agregações do Dashboard da campanha. Tudo conta pessoas do lote (contatos com
// cadência), nunca conversas: cada lead tem uma conversa por canal, e contar
// conversas inflava os números (104 "abordados" para 75 leads).

export type Situacao = 'reuniao' | 'conversando' | 'em_cadencia' | 'concluiu' | 'saiu';

export const SITUACAO_ORDER: Situacao[] = ['reuniao', 'conversando', 'em_cadencia', 'concluiu', 'saiu'];

export const SITUACAO_LABEL: Record<Situacao, string> = {
  reuniao: 'Reunião marcada',
  conversando: 'Respondeu, em conversa',
  em_cadencia: 'Em cadência',
  concluiu: 'Concluiu sem resposta',
  saiu: 'Saiu da lista',
};

export type CadenceBucket = 'entregue' | 'aguardando' | 'barrado' | 'pendente' | 'pulado';

export const BUCKET_ORDER: CadenceBucket[] = ['entregue', 'aguardando', 'barrado', 'pendente', 'pulado'];

export const BUCKET_LABEL: Record<CadenceBucket, string> = {
  entregue: 'Entregue',
  aguardando: 'Enviado, sem confirmação',
  barrado: 'Barrado ou e-mail inválido',
  pendente: 'Agendado',
  pulado: 'Pulado ou cancelado',
};

// Dia do playbook de cada toque da cadência (Passo 4).
export const TOUCH_DAY: Record<number, string> = { 1: 'D0', 2: 'D3', 3: 'D6', 4: 'D9', 5: 'D13' };

const TZ = 'America/Sao_Paulo';
const NEGATIVE = new Set(['negativa', 'descadastro']);
const NO_REPLY = 'Sem resposta (fim da cadência)';

export const fmtDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ });

const dayKey = (date: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);

export function bucketOf(touch: PilotTouch): CadenceBucket {
  switch (touch.state) {
    case 'entregue':
    case 'lido':
      return 'entregue';
    // E-mail não tem recibo de entrega: enviado sem bounce conta como entregue.
    case 'enviado':
      return touch.canal === 'E-mail' ? 'entregue' : 'aguardando';
    case 'barrado':
    case 'bounce':
      return 'barrado';
    case 'pendente':
      return 'pendente';
    default:
      return 'pulado';
  }
}

export interface LeadView {
  row: PilotLoteRow;
  situacao: Situacao;
  detalhe: string;
}

export function situacaoOf(row: PilotLoteRow): Pick<LeadView, 'situacao' | 'detalhe'> {
  if (row.reuniao) {
    return { situacao: 'reuniao', detalhe: `Reunião ${row.reuniao}${row.qualificada ? ' · qualificada' : ''}` };
  }
  const type = row.replyType ?? row.replyTypeSuggested;
  const manualLoss = row.lossReason && row.lossReason !== NO_REPLY ? row.lossReason : null;
  if (row.optOut || row.bounced || (type && NEGATIVE.has(type)) || manualLoss) {
    const motivo = manualLoss
      ?? row.optOutReason
      ?? (row.bounced ? 'E-mail inválido (bounce)' : row.optOut ? 'Pediu para sair da lista' : 'Resposta negativa');
    return { situacao: 'saiu', detalhe: motivo };
  }
  if (row.respondeu) {
    const canal = row.canalResposta === 'whatsapp' ? ' pelo WhatsApp' : row.canalResposta === 'email' ? ' por e-mail' : '';
    return { situacao: 'conversando', detalhe: `Respondeu${canal}${row.respondeuEm ? ` em ${fmtDay(row.respondeuEm)}` : ''}` };
  }
  const next = row.touches.find((t) => t.state === 'pendente');
  if (next) {
    return {
      situacao: 'em_cadencia',
      detalhe: `Próximo: ${TOUCH_DAY[next.step] ?? `passo ${next.step}`} · ${next.canal}${next.at ? ` em ${fmtDay(next.at)}` : ''}`,
    };
  }
  return { situacao: 'concluiu', detalhe: row.lossReason ?? 'Cadência concluída sem resposta' };
}

export const toViews = (rows: PilotLoteRow[]): LeadView[] => rows.map((row) => ({ row, ...situacaoOf(row) }));

export function groupBySituacao(views: LeadView[]): Record<Situacao, string[]> {
  const out: Record<Situacao, string[]> = { reuniao: [], conversando: [], em_cadencia: [], concluiu: [], saiu: [] };
  for (const v of views) out[v.situacao].push(v.row.contactId);
  return out;
}

export interface FunnelStage {
  key: string;
  label: string;
  ids: string[];
}

export function buildFunnel(rows: PilotLoteRow[]): FunnelStage[] {
  const ids = (pred: (r: PilotLoteRow) => boolean) => rows.filter(pred).map((r) => r.contactId);
  return [
    { key: 'lote', label: 'Leads no lote', ids: ids(() => true) },
    { key: 'email', label: 'Receberam e-mail', ids: ids((r) => r.touches.some((t) => t.canal === 'E-mail' && t.state === 'enviado')) },
    { key: 'whatsapp', label: 'Receberam WhatsApp', ids: ids((r) => r.touches.some((t) => t.canal === 'WhatsApp' && (t.state === 'entregue' || t.state === 'lido'))) },
    { key: 'respondeu', label: 'Responderam', ids: ids((r) => r.respondeu) },
    { key: 'autorizou', label: 'Autorizaram o contato', ids: ids((r) => r.autorizacao === 'sim') },
    { key: 'reuniao', label: 'Reunião marcada', ids: ids((r) => Boolean(r.reuniao)) },
    { key: 'qualificada', label: 'Reunião qualificada', ids: ids((r) => r.qualificada) },
  ];
}

export interface CadenceStepView {
  step: number;
  dia: string;
  canal: PilotTouch['canal'];
  total: number;
  buckets: Record<CadenceBucket, string[]>;
  lidos: number;
  proximo: string | null;
}

export function buildCadence(rows: PilotLoteRow[]): CadenceStepView[] {
  const byStep = new Map<number, CadenceStepView>();
  for (const row of rows) {
    for (const touch of row.touches) {
      let view = byStep.get(touch.step);
      if (!view) {
        view = {
          step: touch.step,
          dia: TOUCH_DAY[touch.step] ?? `Passo ${touch.step}`,
          canal: touch.canal,
          total: 0,
          buckets: { entregue: [], aguardando: [], barrado: [], pendente: [], pulado: [] },
          lidos: 0,
          proximo: null,
        };
        byStep.set(touch.step, view);
      }
      view.total += 1;
      view.buckets[bucketOf(touch)].push(row.contactId);
      if (touch.state === 'lido') view.lidos += 1;
      if (touch.state === 'pendente' && touch.at && (!view.proximo || touch.at < view.proximo)) view.proximo = touch.at;
    }
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}

export interface ActivityDay {
  key: string;
  label: string;
  toquesEmail: number;
  toquesWhatsapp: number;
  respostasEmail: number;
  respostasWhatsapp: number;
}

const DISPATCHED = new Set<PilotTouch['state']>(['enviado', 'entregue', 'lido', 'barrado', 'bounce']);

export function buildActivity(
  rows: PilotLoteRow[],
  replies: PilotCampaignReply[],
  days: number,
  now: Date = new Date(),
): ActivityDay[] {
  const list: ActivityDay[] = [];
  const index = new Map<string, ActivityDay>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now.getTime() - i * 86_400_000);
    const day: ActivityDay = {
      key: dayKey(date),
      label: fmtDay(date.toISOString()),
      toquesEmail: 0,
      toquesWhatsapp: 0,
      respostasEmail: 0,
      respostasWhatsapp: 0,
    };
    list.push(day);
    index.set(day.key, day);
  }
  for (const row of rows) {
    for (const touch of row.touches) {
      if (!touch.at || !DISPATCHED.has(touch.state)) continue;
      const day = index.get(dayKey(new Date(touch.at)));
      if (!day) continue;
      if (touch.canal === 'E-mail') day.toquesEmail += 1;
      else day.toquesWhatsapp += 1;
    }
  }
  for (const reply of replies) {
    const day = index.get(dayKey(new Date(reply.at)));
    if (!day) continue;
    if (reply.canal === 'E-mail') day.respostasEmail += 1;
    else day.respostasWhatsapp += 1;
  }
  return list;
}

export const pct = (part: number, total: number): string =>
  total > 0 ? `${((part / total) * 100).toFixed(1).replace('.', ',')}%` : '—';
