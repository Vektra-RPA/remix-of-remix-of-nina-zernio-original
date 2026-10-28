import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Loader2, Users, Send, MessageSquare, CalendarCheck, Megaphone, LifeBuoy, AlertTriangle, ChevronRight, LogOut, Search,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/ui/badge';
import { LeadListSheet, type LeadDrill } from '@/components/LeadListSheet';
import { toast } from 'sonner';
import {
  pilotApi, LOSS_REASONS, REPLY_TYPE_LABEL,
  type PilotCampaign, type PilotLoteRow, type PilotOverview, type PilotTouch, type ReplyType,
} from '@/services/pilot';
import {
  SITUACAO_LABEL, SITUACAO_ORDER, buildFunnel, groupBySituacao, toViews, type LeadView, type Situacao,
} from '@/domain/campaign-dashboard';

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

// Dia do playbook de cada toque da cadência (Passo 4).
const TOUCH_DAY: Record<number, string> = { 1: 'D0', 2: 'D3', 3: 'D6', 4: 'D9', 5: 'D13' };

const TOUCH_STYLE: Record<PilotTouch['state'], string> = {
  pendente: 'text-muted-foreground border-border',
  enviado: 'text-sky-500 border-sky-500/40',
  entregue: 'text-emerald-500 border-emerald-500/40',
  lido: 'text-emerald-500 border-emerald-500/60 bg-emerald-500/10',
  barrado: 'text-red-500 border-red-500/40',
  bounce: 'text-red-500 border-red-500/40',
  pulado: 'text-muted-foreground border-dashed border-border',
  cancelado: 'text-muted-foreground border-dashed border-border line-through',
};

const touchTitle = (t: PilotTouch): string =>
  [`${TOUCH_DAY[t.step] ?? `Step ${t.step}`} · ${t.canal}: ${t.state}`, t.at ? fmtDate(t.at) : null, t.detail]
    .filter(Boolean).join(' — ');

const selectClass = 'w-full min-w-[9rem] rounded-lg border border-border bg-background p-1.5 text-xs';

// As duas classificações só fazem sentido quando há o que classificar: tipo de
// resposta depois que o lead responde (ou sai); motivo de perda quando o lead
// saiu, a cadência acabou sem reunião ou a conversa esfriou. Valor já marcado
// sempre aparece, para poder corrigir.
const canClassifyReply = (row: PilotLoteRow): boolean =>
  row.replyType !== null || row.respondeu || row.optOut || Boolean(row.reuniao);

const canClassifyLoss = (row: PilotLoteRow, view: LeadView | undefined): boolean =>
  row.lossReason !== null || (!row.reuniao && (view?.situacao === 'saiu' || view?.situacao === 'concluiu' || view?.situacao === 'conversando'));

const Pilot: React.FC = () => {
  const [data, setData] = useState<PilotOverview | null>(null);
  const [campaign, setCampaign] = useState<PilotCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<LeadDrill | null>(null);
  const [filtro, setFiltro] = useState<'todos' | Situacao>('todos');
  const [busca, setBusca] = useState('');
  const escalationsRef = useRef<HTMLElement>(null);
  const lote = campaign?.lote ?? null;

  const views = useMemo(() => toViews(lote?.rows ?? []), [lote]);
  const viewOf = useMemo(() => new Map(views.map((v) => [v.row.contactId, v])), [views]);

  const load = async () => {
    setLoading(true);
    try {
      const [overview, campaignData] = await Promise.all([pilotApi.fetchOverview(), pilotApi.fetchCampaign()]);
      setData(overview);
      setCampaign(campaignData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível carregar o painel do piloto.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Classificação da dona da campanha (Passo 7.1): grava e atualiza a linha.
  const saveOutcome = async (contactId: string, patch: { reply_type?: ReplyType | null; loss_reason?: string | null }) => {
    try {
      await pilotApi.saveOutcome(contactId, patch);
      setCampaign((cur) => cur && {
        ...cur,
        lote: {
          ...cur.lote,
          rows: cur.lote.rows.map((r) => (r.contactId !== contactId ? r : {
            ...r,
            ...('reply_type' in patch ? { replyType: patch.reply_type ?? null } : {}),
            ...('loss_reason' in patch ? { lossReason: patch.loss_reason ?? null } : {}),
          })),
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar a classificação.');
    }
  };

  // Cards do topo: contam leads do lote (pessoas); testes internos aparecem à
  // parte no rodapé do card e na lista, sem entrar no número.
  const rows = lote?.rows ?? [];
  const outside = campaign?.foraDoLote ?? [];
  const outsideReplied = outside.filter((c) => c.respondeu);
  const stages = buildFunnel(rows);
  const stage = (key: string) => stages.find((s) => s.key === key)?.ids ?? [];
  const bySituacao = groupBySituacao(views);
  const abordados = rows
    .filter((r) => r.touches.some((t) => ['enviado', 'entregue', 'lido', 'barrado', 'bounce'].includes(t.state)))
    .map((r) => r.contactId);
  const escaladas = data?.funnel.escaladas ?? 0;
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const filteredRows = rows.filter((r) =>
    (filtro === 'todos' || viewOf.get(r.contactId)?.situacao === filtro)
    && (!termo || `${r.nome} ${r.empresa} ${r.cargo}`.toLocaleLowerCase('pt-BR').includes(termo)));
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const cards = [
    {
      label: 'Leads captados', value: rows.length, icon: Users,
      foot: outside.length > 0 ? `+${plural(outside.length, 'teste fora da conta', 'testes fora da conta')}` : 'Leads do lote',
      onClick: () => setDrill({ title: 'Leads captados', description: 'Todos os leads do lote, com a situação de cada um.', ids: rows.map((r) => r.contactId), outside }),
    },
    {
      label: 'Em cadência', value: bySituacao.em_cadencia.length, icon: Send,
      foot: 'Ainda vão receber toques',
      onClick: () => setDrill({ title: 'Em cadência', description: 'Não responderam e ainda têm toques agendados.', ids: bySituacao.em_cadencia }),
    },
    {
      label: 'Abordados', value: abordados.length, icon: Megaphone,
      foot: 'Receberam ao menos um toque',
      onClick: () => setDrill({ title: 'Abordados', description: 'Leads que já receberam ao menos um e-mail ou WhatsApp.', ids: abordados }),
    },
    {
      label: 'Responderam', value: stage('respondeu').length, icon: MessageSquare,
      foot: outsideReplied.length > 0 ? `+${plural(outsideReplied.length, 'teste', 'testes')} internos` : 'Por e-mail ou WhatsApp',
      onClick: () => setDrill({
        title: 'Responderam',
        description: 'Quem respondeu e em que pé está: pediu para sair, conversa em andamento ou reunião.',
        ids: stage('respondeu'),
        outside: outsideReplied,
      }),
    },
    {
      label: 'Saíram da lista', value: bySituacao.saiu.length, icon: LogOut,
      foot: 'Pediram para sair, bounce ou perda',
      onClick: () => setDrill({ title: 'Saíram da lista', description: 'Quem saiu e o motivo de cada um.', ids: bySituacao.saiu }),
    },
    {
      label: 'Reuniões', value: stage('reuniao').length, icon: CalendarCheck,
      foot: plural(stage('qualificada').length, 'qualificada', 'qualificadas'),
      onClick: () => setDrill({ title: 'Reuniões', description: 'Reuniões de venda marcadas pela Lis.', ids: stage('reuniao') }),
    },
    {
      label: 'Escaladas', value: escaladas, icon: LifeBuoy,
      foot: 'Aguardando um humano',
      onClick: () => escalationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    },
  ];

  return (
    <div className="operation-page custom-scrollbar">
      <div className="operation-container">
        <header className="operation-header">
          <div>
            <p className="via-eyebrow">Operação do piloto</p>
            <h1>Piloto.</h1>
            <p>Do lead captado à reunião agendada — e o que precisa de um humano agora.</p>
          </div>
          <Button variant="primary" className="gap-2" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Atualizar
          </Button>
        </header>

        {data && !data.cadenceAvailable && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 mb-6 text-sm">
            A cadência ainda não foi ativada no banco (migração <code>cadence_state</code> pendente de deploy).
            O número “Em cadência” aparece zerado até lá.
          </div>
        )}

        {/* Funil (Passo 7.4) */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4 mb-8">
          {cards.map((card) => (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              disabled={!campaign}
              aria-label={`${card.label}: ${card.value}. Ver lista`}
              className="group rounded-xl border border-border p-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            >
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <card.icon className="w-4 h-4" /> {card.label}
              </div>
              <p className="text-2xl font-semibold mt-2">{loading && !campaign ? '—' : card.value}</p>
              <p className="mt-1 flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                <span>{card.foot}</span>
                <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60 group-hover:opacity-100" aria-hidden="true" />
              </p>
            </button>
          ))}
        </div>

        {/* Escaladas aguardando humano (Passo 7.3 / alerta da Elisandra) */}
        <section className="mb-8 scroll-mt-6" ref={escalationsRef}>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h2 className="text-lg font-semibold">Precisam de você</h2>
            {data && <Badge variant="secondary">{data.escalations.length}</Badge>}
          </div>

          {loading && !data && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
            </p>
          )}

          {data && data.escalations.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma conversa aguardando atendimento humano. A Lis está dando conta.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {(data?.escalations ?? []).map((e) => (
              <div key={e.conversationId} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {e.nome}{e.empresa !== '—' ? ` · ${e.empresa}` : ''}
                    </p>
                    <p className="text-sm text-muted-foreground">{e.motivo}</p>
                    {e.resumo !== '—' && <p className="text-xs text-muted-foreground mt-1">Resumo: {e.resumo}</p>}
                    {e.routing && <p className="text-xs text-muted-foreground mt-1">Encaminhar para: <span className="text-foreground font-medium">{e.routing}</span></p>}
                    <p className="text-xs text-muted-foreground mt-1">{e.canal} · {e.contato} · {fmtDate(e.requestedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={e.alerted ? 'secondary' : 'outline'}>
                      {e.alerted ? 'Elisandra avisada' : 'Sem aviso'}
                    </Badge>
                    <Link to="/chat">
                      <Button variant="secondary" className="gap-2">
                        <MessageSquare className="w-4 h-4" /> Abrir
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Lote atual (Passos 7.3 e 7.4): números e uma linha por contato */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold">Lote atual</h2>
            {lote && (
              <Badge variant="secondary">
                {filteredRows.length === lote.rows.length ? `${lote.rows.length} leads` : `${filteredRows.length} de ${lote.rows.length} leads`}
              </Badge>
            )}
          </div>

          {lote && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {lote.indicators.map((ind) => (
                <div key={ind.label} className={`rounded-xl border p-4 ${ind.alert ? 'border-red-500/50 bg-red-500/5' : 'border-border'}`}>
                  <p className="text-xs text-muted-foreground">{ind.label}</p>
                  <p className="text-2xl font-semibold mt-1">{ind.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{ind.detail}</p>
                  <p className="text-[11px] text-muted-foreground/80 mt-1">Referência: {ind.reference}</p>
                </div>
              ))}
            </div>
          )}

          {lote && lote.rows.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhum contato em cadência ainda.</p>
            </div>
          )}

          {lote && lote.rows.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar leads do lote">
              {(['todos', ...SITUACAO_ORDER] as const).map((key) => {
                const count = key === 'todos' ? rows.length : bySituacao[key].length;
                const active = filtro === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFiltro(key)}
                    aria-pressed={active}
                    disabled={count === 0 && !active}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${
                      active ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    {key === 'todos' ? 'Todos' : SITUACAO_LABEL[key]} <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
              <label className="ml-auto flex items-center gap-2 rounded-lg border border-border px-2 py-1">
                <Search className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar nome ou empresa"
                  aria-label="Buscar lead por nome ou empresa"
                  className="w-48 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </label>
            </div>
          )}

          {lote && lote.rows.length > 0 && filteredRows.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">Nenhum lead com esse filtro.</p>
            </div>
          )}

          {lote && filteredRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="p-3 font-medium">Lead</th>
                    <th className="p-3 font-medium">Situação</th>
                    <th className="p-3 font-medium">Persona</th>
                    <th className="p-3 font-medium">Toques</th>
                    <th className="p-3 font-medium">Entregue</th>
                    <th className="p-3 font-medium">Respondeu</th>
                    <th className="p-3 font-medium">Autorização</th>
                    <th className="p-3 font-medium">Tipo de resposta</th>
                    <th className="p-3 font-medium">Reunião</th>
                    <th className="p-3 font-medium">Motivo de perda</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.contactId} className="border-b border-border/60 last:border-0 align-top">
                      <td className="p-3 min-w-[12rem]">
                        <p className="font-medium">{row.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {[row.empresa !== '—' ? row.empresa : null, row.cargo !== '—' ? row.cargo : null].filter(Boolean).join(' · ')}
                        </p>
                      </td>
                      <td className="p-3 min-w-[11rem]">
                        {(() => {
                          const view = viewOf.get(row.contactId);
                          if (!view) return '—';
                          return (
                            <>
                              <p className="flex items-center gap-1.5 font-medium">
                                <span className={`dash-swatch dash-sit--${view.situacao}`} aria-hidden="true" />
                                {SITUACAO_LABEL[view.situacao]}
                              </p>
                              <p className="text-xs text-muted-foreground">{view.detalhe}</p>
                            </>
                          );
                        })()}
                      </td>
                      <td className="p-3 whitespace-nowrap">{row.persona}{row.score !== null ? ` · ${row.score}` : ''}</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {row.touches.map((t) => (
                            <span
                              key={t.step}
                              title={touchTitle(t)}
                              className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TOUCH_STYLE[t.state]}`}
                            >
                              {TOUCH_DAY[t.step] ?? t.step}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3">{row.entregue ? 'Sim' : 'Não'}</td>
                      <td className="p-3">{row.respondeu ? 'Sim' : 'Não'}</td>
                      <td className="p-3">{row.autorizacao === 'sim' ? 'Sim' : row.autorizacao === 'negada' ? 'Negada' : '—'}</td>
                      <td className="p-3">
                        {canClassifyReply(row) ? (
                          <select
                            className={selectClass}
                            value={row.replyType ?? ''}
                            onChange={(e) => saveOutcome(row.contactId, { reply_type: (e.target.value || null) as ReplyType | null })}
                          >
                            <option value="">
                              {row.replyTypeSuggested ? `Sugestão: ${REPLY_TYPE_LABEL[row.replyTypeSuggested]}` : 'Classificar…'}
                            </option>
                            {(Object.keys(REPLY_TYPE_LABEL) as ReplyType[]).map((key) => (
                              <option key={key} value={key}>{REPLY_TYPE_LABEL[key]}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground" title="Só se preenche depois que o lead responder.">Sem resposta ainda</span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {row.reuniao ? (
                          <>
                            <p>{row.reuniao}</p>
                            <p className="text-xs text-muted-foreground">{row.qualificada ? 'Qualificada' : 'Não qualificada'}</p>
                          </>
                        ) : '—'}
                      </td>
                      <td className="p-3">
                        {canClassifyLoss(row, viewOf.get(row.contactId)) ? (
                          <select
                            className={selectClass}
                            value={row.lossReason ?? ''}
                            onChange={(e) => saveOutcome(row.contactId, { loss_reason: e.target.value || null })}
                          >
                            <option value="">{row.lossReasonSuggested ? `Sugestão: ${row.lossReasonSuggested}` : 'Se perdeu, por quê?'}</option>
                            {LOSS_REASONS.map((reason) => (
                              <option key={reason} value={reason}>{reason}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground" title="Só se preenche quando o lead sair ou a cadência terminar sem reunião.">
                            {row.reuniao ? 'Tem reunião' : 'Em cadência'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Passe o mouse nos toques para ver data e detalhe. Verde = entregue ou lido; vermelho = barrado pela Meta ou bounce.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            <strong className="font-medium text-foreground">Tipo de resposta</strong> e <strong className="font-medium text-foreground">Motivo de perda</strong> são
            a leitura humana do lote (playbook 7.1 e 7.3): só aparecem quando há o que classificar — depois que o lead responde, sai
            ou termina a cadência sem reunião. Alimentam os indicadores “Resposta positiva” e “Descadastro” e mostram por que
            perdemos cada lead. “Sugestão” é o que o sistema inferiu; escolha um valor para confirmar.
          </p>
        </section>

        {/* Leads recentes */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Leads recentes</h2>
          {data && data.leads.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">Sem conversas ativas ainda.</p>
            </div>
          )}
          {data && data.leads.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="p-3 font-medium">Lead</th>
                    <th className="p-3 font-medium">Persona</th>
                    <th className="p-3 font-medium">Score</th>
                    <th className="p-3 font-medium">Canal</th>
                    <th className="p-3 font-medium">Estado</th>
                    <th className="p-3 font-medium">Última atividade</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leads.map((lead) => (
                    <tr key={lead.conversationId} className="border-b border-border/60 last:border-0">
                      <td className="p-3">
                        <p className="font-medium">{lead.nome}</p>
                        {lead.empresa !== '—' && <p className="text-xs text-muted-foreground">{lead.empresa}</p>}
                      </td>
                      <td className="p-3">{lead.persona}</td>
                      <td className="p-3">{lead.score ?? '—'}</td>
                      <td className="p-3">{lead.canal}</td>
                      <td className="p-3"><Badge variant="outline">{lead.statusLabel}</Badge></td>
                      <td className="p-3 text-muted-foreground">{fmtDate(lead.ultimaAtividade)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <LeadListSheet
        drill={drill}
        viewOf={viewOf}
        conversationOf={campaign?.conversationOf ?? {}}
        onClose={() => setDrill(null)}
      />
    </div>
  );
};

export default Pilot;
