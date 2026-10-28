import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Ban,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  LogOut,
  MessageSquare,
  RefreshCw,
  Send,
  SkipForward,
  Users,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipProps } from 'recharts';
import { toast } from 'sonner';

import { pilotApi, type PilotCampaign } from '../services/pilot';
import {
  BUCKET_LABEL,
  BUCKET_ORDER,
  SITUACAO_LABEL,
  SITUACAO_ORDER,
  buildActivity,
  buildCadence,
  buildFunnel,
  fmtDay,
  groupBySituacao,
  pct,
  toViews,
  type CadenceBucket,
  type LeadView,
  type Situacao,
} from '../domain/campaign-dashboard';
import { LeadListSheet, type LeadDrill } from './LeadListSheet';
import { OnboardingBanner } from './OnboardingBanner';
import { SystemHealthCard } from './SystemHealthCard';
import './Dashboard.css';
import './DashboardCampaign.css';

interface OutletContext {
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
}

type PeriodDays = 7 | 14 | 30;

const PERIODS: PeriodDays[] = [7, 14, 30];

const BUCKET_ICON: Record<CadenceBucket, React.ElementType> = {
  entregue: CheckCircle2,
  aguardando: Send,
  barrado: Ban,
  pendente: Clock,
  pulado: SkipForward,
};

const SITUACAO_ICON: Record<Situacao, React.ElementType> = {
  reuniao: CalendarCheck,
  conversando: MessageSquare,
  em_cadencia: Send,
  concluiu: Clock,
  saiu: LogOut,
};

const ActivityTooltip: React.FC<TooltipProps<number, string> & { kind: 'toques' | 'respostas' }> = ({ active, payload, label, kind }) => {
  if (!active || !payload?.length) return null;
  const email = Number(payload.find((p) => String(p.dataKey).endsWith('Email'))?.value ?? 0);
  const whatsapp = Number(payload.find((p) => String(p.dataKey).endsWith('Whatsapp'))?.value ?? 0);
  return (
    <div className="dash-tooltip">
      <p className="dash-tooltip__title">{label} · {kind === 'toques' ? 'toques disparados' : 'respostas de leads'}</p>
      <p><span className="dash-swatch dash-swatch--s1" aria-hidden="true" />E-mail <strong>{email}</strong></p>
      <p><span className="dash-swatch dash-swatch--s2" aria-hidden="true" />WhatsApp <strong>{whatsapp}</strong></p>
    </div>
  );
};

const Dashboard: React.FC = () => {
  const [data, setData] = useState<PilotCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [period, setPeriod] = useState<PeriodDays>(14);
  const [drill, setDrill] = useState<LeadDrill | null>(null);
  const [showOutside, setShowOutside] = useState(false);
  const [readout, setReadout] = useState<Record<string, string>>({});
  const { setShowOnboarding } = useOutletContext<OutletContext>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await pilotApi.fetchCampaign());
      setLoadedAt(new Date());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar o painel da campanha.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = data?.lote.rows ?? [];
  const views = useMemo(() => toViews(rows), [rows]);
  const viewOf = useMemo(() => new Map(views.map((v) => [v.row.contactId, v])), [views]);
  const bySituacao = useMemo(() => groupBySituacao(views), [views]);
  const funnel = useMemo(() => buildFunnel(rows), [rows]);
  const cadence = useMemo(() => buildCadence(rows), [rows]);
  const activity = useMemo(() => buildActivity(rows, data?.replies ?? [], period), [rows, data, period]);

  const total = rows.length;
  const responded = funnel.find((s) => s.key === 'respondeu')?.ids ?? [];
  const meetings = funnel.find((s) => s.key === 'reuniao')?.ids ?? [];
  const qualified = funnel.find((s) => s.key === 'qualificada')?.ids ?? [];
  const inCadence = bySituacao.em_cadencia;
  const left = bySituacao.saiu;
  const nextTouch = cadence.filter((s) => s.proximo).sort((a, b) => String(a.proximo).localeCompare(String(b.proximo)))[0];
  const totals = activity.reduce(
    (acc, d) => ({ toques: acc.toques + d.toquesEmail + d.toquesWhatsapp, respostas: acc.respostas + d.respostasEmail + d.respostasWhatsapp }),
    { toques: 0, respostas: 0 },
  );

  const open = (title: string, description: string, ids: string[], outside?: LeadDrill['outside']) =>
    setDrill({ title, description, ids, outside });
  const hover = (key: string, text: string | null) =>
    setReadout((cur) => {
      const next = { ...cur };
      if (text) next[key] = text;
      else delete next[key];
      return next;
    });

  if (loading && !data) {
    return (
      <div className="dashboard-loading" role="status" aria-label="Carregando visão geral">
        <div className="dashboard-loading-icon">
          <Loader2 className="animate-spin" aria-hidden="true" />
        </div>
        <p>Carregando a campanha</p>
      </div>
    );
  }

  const cards = [
    {
      key: 'lote',
      label: 'Leads no lote',
      value: total,
      foot: data?.foraDoLote.length ? `+${data.foraDoLote.length} fora dos números (testes)` : 'Só leads reais',
      icon: Users,
      onClick: () => open('Leads no lote', 'Todos os leads que entraram na cadência.', rows.map((r) => r.contactId), data?.foraDoLote),
    },
    {
      key: 'cadencia',
      label: 'Em cadência',
      value: inCadence.length,
      foot: nextTouch?.proximo ? `Próximo: ${nextTouch.dia} · ${nextTouch.canal} em ${fmtDay(nextTouch.proximo)}` : 'Sem toques agendados',
      icon: Send,
      onClick: () => open('Em cadência', 'Leads que ainda vão receber toques e não responderam.', inCadence),
    },
    {
      key: 'responderam',
      label: 'Responderam',
      value: responded.length,
      foot: `${pct(responded.length, total)} do lote · mercado: 3 a 8%`,
      icon: MessageSquare,
      onClick: () => open('Responderam', 'Leads que responderam por e-mail ou WhatsApp, inclusive para sair.', responded, data?.foraDoLote.filter((c) => c.respondeu)),
    },
    {
      key: 'saiu',
      label: 'Saíram da lista',
      value: left.length,
      foot: `${pct(left.length, total)} do lote · limite: 2%`,
      icon: LogOut,
      alert: total > 0 && left.length / total > 0.02,
      onClick: () => open('Saíram da lista', 'Pediram para sair, e-mail inválido ou classificados como perda no Piloto.', left),
    },
    {
      key: 'reunioes',
      label: 'Reuniões',
      value: meetings.length,
      foot: `${qualified.length} qualificada${qualified.length === 1 ? '' : 's'}`,
      icon: CalendarCheck,
      onClick: () => open('Reuniões marcadas', 'Reuniões de venda agendadas pela Lis.', meetings),
    },
  ];

  const funnelMax = Math.max(funnel[0]?.ids.length ?? 0, 1);
  const leftViews = left.map((id) => viewOf.get(id)).filter((v): v is LeadView => Boolean(v));

  return (
    <div className="dashboard-page custom-scrollbar">
      <div className="dashboard-container">
        <header className="dashboard-header">
          <div>
            <p className="via-eyebrow">Prospecção da Lis</p>
            <h1>Visão geral da campanha.</h1>
            <p>
              {total} leads no lote
              {loadedAt ? ` · atualizado às ${loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
              . Clique em qualquer número para ver quem está por trás dele.
            </p>
          </div>
          <button type="button" className="dash-refresh" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Atualizar
          </button>
        </header>

        <OnboardingBanner onOpenWizard={() => setShowOnboarding(true)} />
        <SystemHealthCard />

        <section aria-label="Indicadores da campanha" className="dash-kpis">
          {cards.map((card) => (
            <button
              key={card.key}
              type="button"
              className={`via-metric via-metric--atmos dashboard-metric dash-kpi${card.alert ? ' is-alert' : ''}`}
              onClick={card.onClick}
              aria-label={`${card.label}: ${card.value}. Ver lista`}
            >
              <span className="dashboard-metric-top">
                <span className="via-metric__label">{card.label}</span>
                <span className="dashboard-metric-icon"><card.icon aria-hidden="true" /></span>
              </span>
              <strong className="via-metric__value">{card.value}</strong>
              <span className="via-metric__foot dash-kpi__foot">
                <span>{card.foot}</span>
                <ChevronRight aria-hidden="true" />
              </span>
            </button>
          ))}
        </section>

        {total === 0 ? (
          <section className="via-card dash-card dash-empty">
            <h2>Nenhum lead em cadência ainda.</h2>
            <p>Quando o primeiro lote entrar na cadência, o funil e a evolução dos toques aparecem aqui.</p>
          </section>
        ) : (
          <>
            <section className="dash-grid-2">
              <article className="via-card dash-card">
                <header className="dashboard-card-header">
                  <div>
                    <p className="via-eyebrow">Situação</p>
                    <h2>Onde estão os {total} leads</h2>
                    <p>Cada lead aparece em um só grupo.</p>
                  </div>
                </header>
                <div className="dash-stack" role="group" aria-label="Situação dos leads">
                  {SITUACAO_ORDER.filter((s) => bySituacao[s].length > 0).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`dash-seg dash-sit--${s}`}
                      style={{ flexGrow: bySituacao[s].length }}
                      aria-label={`${SITUACAO_LABEL[s]}: ${bySituacao[s].length}`}
                      onMouseEnter={() => hover('sit', `${SITUACAO_LABEL[s]}: ${bySituacao[s].length} (${pct(bySituacao[s].length, total)})`)}
                      onMouseLeave={() => hover('sit', null)}
                      onClick={() => open(SITUACAO_LABEL[s], 'Leads nesta situação agora.', bySituacao[s])}
                    />
                  ))}
                </div>
                <p className="dash-readout" aria-live="polite">{readout.sit ?? 'Passe o mouse ou clique em uma faixa.'}</p>
                <ul className="dash-legend">
                  {SITUACAO_ORDER.map((s) => {
                    const Icon = SITUACAO_ICON[s];
                    return (
                      <li key={s}>
                        <button
                          type="button"
                          disabled={bySituacao[s].length === 0}
                          onClick={() => open(SITUACAO_LABEL[s], 'Leads nesta situação agora.', bySituacao[s])}
                        >
                          <span className={`dash-swatch dash-sit--${s}`} aria-hidden="true" />
                          <Icon aria-hidden="true" />
                          <span className="dash-legend__label">{SITUACAO_LABEL[s]}</span>
                          <strong>{bySituacao[s].length}</strong>
                          <span className="dash-legend__pct">{pct(bySituacao[s].length, total)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </article>

              <article className="via-card dash-card">
                <header className="dashboard-card-header">
                  <div>
                    <p className="via-eyebrow">Funil</p>
                    <h2>Do lote à reunião</h2>
                    <p>Percentual sobre os {total} leads do lote.</p>
                  </div>
                </header>
                <ol className="dash-funnel">
                  {funnel.map((stage) => (
                    <li key={stage.key}>
                      <button
                        type="button"
                        onClick={() => open(stage.label, 'Leads que chegaram a esta etapa.', stage.ids)}
                        disabled={stage.ids.length === 0}
                        aria-label={`${stage.label}: ${stage.ids.length}`}
                      >
                        <span className="dash-funnel__label">{stage.label}</span>
                        <span className="dash-funnel__track" aria-hidden="true">
                          <span
                            className="dash-funnel__fill"
                            style={{ width: `${stage.ids.length > 0 ? Math.max((stage.ids.length / funnelMax) * 100, 1.5) : 0}%` }}
                          />
                        </span>
                        <strong>{stage.ids.length}</strong>
                        <span className="dash-funnel__pct">{pct(stage.ids.length, total)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </article>
            </section>

            <section className="via-card dash-card">
              <header className="dashboard-card-header">
                <div>
                  <p className="via-eyebrow">Cadência</p>
                  <h2>Evolução de cada toque</h2>
                  <p>O que aconteceu com cada envio do playbook, lead a lead.</p>
                </div>
              </header>
              <ul className="dash-legend dash-legend--inline" aria-label="Legenda da cadência">
                {BUCKET_ORDER.map((b) => {
                  const Icon = BUCKET_ICON[b];
                  return (
                    <li key={b}>
                      <span className={`dash-swatch dash-b--${b}`} aria-hidden="true" />
                      <Icon aria-hidden="true" />
                      <span className="dash-legend__label">{BUCKET_LABEL[b]}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="dash-cadence">
                {cadence.map((step) => {
                  const key = `step-${step.step}`;
                  const delivered = step.buckets.entregue.length;
                  const dispatched = delivered + step.buckets.aguardando.length + step.buckets.barrado.length;
                  const skipped = step.buckets.pulado.length;
                  const summary = [
                    dispatched > 0 ? `${delivered} entregue${delivered === 1 ? '' : 's'}` : null,
                    step.buckets.aguardando.length > 0 ? `${step.buckets.aguardando.length} sem confirmação` : null,
                    step.canal === 'WhatsApp' && step.lidos > 0 ? `${step.lidos} lido${step.lidos === 1 ? '' : 's'}` : null,
                    step.buckets.barrado.length > 0 ? `${step.buckets.barrado.length} barrado${step.buckets.barrado.length === 1 ? '' : 's'}` : null,
                    step.proximo ? `${step.buckets.pendente.length} agendado${step.buckets.pendente.length === 1 ? '' : 's'} a partir de ${fmtDay(step.proximo)}` : null,
                    skipped > 0 ? `${skipped} pulado${skipped === 1 ? '' : 's'} ou cancelado${skipped === 1 ? '' : 's'}` : null,
                  ].filter(Boolean).join(' · ');
                  return (
                    <div key={step.step} className="dash-cadence__row">
                      <div className="dash-cadence__name">
                        <strong>{step.dia}</strong>
                        <span>{step.canal}</span>
                      </div>
                      <div className="dash-cadence__body">
                        <div className="dash-stack dash-stack--thin" role="group" aria-label={`${step.dia} ${step.canal}`}>
                          {BUCKET_ORDER.filter((b) => step.buckets[b].length > 0).map((b) => (
                            <button
                              key={b}
                              type="button"
                              className={`dash-seg dash-b--${b}`}
                              style={{ flexGrow: step.buckets[b].length }}
                              aria-label={`${BUCKET_LABEL[b]}: ${step.buckets[b].length}`}
                              onMouseEnter={() => hover(key, `${BUCKET_LABEL[b]}: ${step.buckets[b].length} de ${step.total}`)}
                              onMouseLeave={() => hover(key, null)}
                              onClick={() => open(`${step.dia} · ${step.canal}: ${BUCKET_LABEL[b].toLowerCase()}`, `${step.buckets[b].length} de ${step.total} leads neste toque.`, step.buckets[b])}
                            />
                          ))}
                        </div>
                        <p className="dash-readout" aria-live="polite">{readout[key] ?? summary}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="via-card dash-card">
              <header className="dashboard-card-header">
                <div>
                  <p className="via-eyebrow">Atividade</p>
                  <h2>Toques e respostas por dia</h2>
                  <p>
                    {totals.toques} toques disparados e {totals.respostas} mensagens de leads nos últimos {period} dias.
                  </p>
                </div>
                <div className="dashboard-period" role="group" aria-label="Período da atividade">
                  {PERIODS.map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setPeriod(days)}
                      aria-pressed={period === days}
                      className={period === days ? 'is-active' : undefined}
                    >
                      {days} dias
                    </button>
                  ))}
                </div>
              </header>
              <ul className="dash-legend dash-legend--inline" aria-label="Legenda dos canais">
                <li><span className="dash-swatch dash-swatch--s1" aria-hidden="true" /><span className="dash-legend__label">E-mail</span></li>
                <li><span className="dash-swatch dash-swatch--s2" aria-hidden="true" /><span className="dash-legend__label">WhatsApp</span></li>
              </ul>
              <div className="dash-grid-2 dash-grid-2--tight">
                {(['toques', 'respostas'] as const).map((kind) => (
                  <figure key={kind} className="dash-mini">
                    <figcaption>{kind === 'toques' ? 'Toques disparados pela cadência' : 'Mensagens recebidas de leads'}</figcaption>
                    <div className="dashboard-chart dash-mini__chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={activity} margin={{ top: 8, right: 8, left: -24, bottom: 0 }} barCategoryGap="22%">
                          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--via-data-grid)" />
                          <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={8} fontSize={11} stroke="var(--via-data-ink)" minTickGap={14} />
                          <YAxis allowDecimals={false} axisLine={false} tickLine={false} fontSize={11} stroke="var(--via-data-ink)" />
                          <Tooltip cursor={{ fill: 'var(--via-navy-05)' }} content={<ActivityTooltip kind={kind} />} />
                          <Bar dataKey={`${kind}Email`} stackId="canal" fill="var(--dash-s1)" stroke="var(--via-surface)" strokeWidth={1} />
                          <Bar dataKey={`${kind}Whatsapp`} stackId="canal" fill="var(--dash-s2)" stroke="var(--via-surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </figure>
                ))}
              </div>
            </section>

            <section className="dash-grid-2">
              <article className="via-card dash-card">
                <header className="dashboard-card-header">
                  <div>
                    <p className="via-eyebrow">Saídas</p>
                    <h2>Quem saiu da lista e por quê</h2>
                    <p>Pediram para sair, e-mail inválido ou perda marcada no Piloto.</p>
                  </div>
                </header>
                {leftViews.length === 0 ? (
                  <p className="dash-muted">Ninguém saiu da lista até agora.</p>
                ) : (
                  <ul className="dash-people">
                    {leftViews.map((v) => (
                      <li key={v.row.contactId}>
                        <div>
                          <strong>{v.row.nome}</strong>
                          <span>{[v.row.empresa, v.row.cargo].filter((x) => x && x !== '—').join(' · ')}</span>
                        </div>
                        <p>{v.detalhe}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="via-card dash-card">
                <header className="dashboard-card-header">
                  <div>
                    <p className="via-eyebrow">Fora dos números</p>
                    <h2>Testes e contatos sem cadência</h2>
                    <p>Não entram em nenhum indicador desta página.</p>
                  </div>
                </header>
                {(data?.foraDoLote.length ?? 0) === 0 ? (
                  <p className="dash-muted">Nenhum contato fora do lote.</p>
                ) : (
                  <>
                    <ul className="dash-people">
                      {(showOutside ? data!.foraDoLote : data!.foraDoLote.slice(0, 6)).map((c) => (
                        <li key={c.contactId}>
                          <div>
                            <strong>{c.nome}</strong>
                          </div>
                          <p>{c.detalhe}</p>
                        </li>
                      ))}
                    </ul>
                    {data!.foraDoLote.length > 6 && (
                      <button type="button" className="dash-link" onClick={() => setShowOutside((v) => !v)}>
                        {showOutside ? 'Mostrar menos' : `Ver todos (${data!.foraDoLote.length})`}
                      </button>
                    )}
                  </>
                )}
              </article>
            </section>
          </>
        )}
      </div>

      <LeadListSheet
        drill={drill}
        viewOf={viewOf}
        conversationOf={data?.conversationOf ?? {}}
        onClose={() => setDrill(null)}
      />
    </div>
  );
};

export default Dashboard;
