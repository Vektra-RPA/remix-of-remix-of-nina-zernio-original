import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Loader2, Users, Send, MessageSquare, CalendarCheck, Megaphone, LifeBuoy, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  pilotApi, LOSS_REASONS, REPLY_TYPE_LABEL,
  type PilotLote, type PilotOverview, type PilotTouch, type ReplyType,
} from '@/services/pilot';

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

const Pilot: React.FC = () => {
  const [data, setData] = useState<PilotOverview | null>(null);
  const [lote, setLote] = useState<PilotLote | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [overview, loteData] = await Promise.all([pilotApi.fetchOverview(), pilotApi.fetchLote()]);
      setData(overview);
      setLote(loteData);
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
      setLote((cur) => cur && {
        ...cur,
        rows: cur.rows.map((r) => (r.contactId !== contactId ? r : {
          ...r,
          ...('reply_type' in patch ? { replyType: patch.reply_type ?? null } : {}),
          ...('loss_reason' in patch ? { lossReason: patch.loss_reason ?? null } : {}),
        })),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar a classificação.');
    }
  };

  const funnel = data?.funnel;
  const cards = [
    { label: 'Leads captados', value: funnel?.captados ?? 0, icon: Users },
    { label: 'Em cadência', value: funnel?.emCadencia ?? 0, icon: Send },
    { label: 'Abordados', value: funnel?.abordados ?? 0, icon: Megaphone },
    { label: 'Responderam', value: funnel?.responderam ?? 0, icon: MessageSquare },
    { label: 'Reuniões', value: funnel?.reunioes ?? 0, icon: CalendarCheck },
    { label: 'Escaladas', value: funnel?.escaladas ?? 0, icon: LifeBuoy },
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {cards.map((card) => (
            <div key={card.label} className="rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <card.icon className="w-4 h-4" /> {card.label}
              </div>
              <p className="text-2xl font-semibold mt-2">{loading && !data ? '—' : card.value}</p>
            </div>
          ))}
        </div>

        {/* Escaladas aguardando humano (Passo 7.3 / alerta da Elisandra) */}
        <section className="mb-8">
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
            {lote && <Badge variant="secondary">{lote.rows.length} contatos</Badge>}
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
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="p-3 font-medium">Lead</th>
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
                  {lote.rows.map((row) => (
                    <tr key={row.contactId} className="border-b border-border/60 last:border-0 align-top">
                      <td className="p-3 min-w-[12rem]">
                        <p className="font-medium">{row.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {[row.empresa !== '—' ? row.empresa : null, row.cargo !== '—' ? row.cargo : null].filter(Boolean).join(' · ')}
                        </p>
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
                        <select
                          className={selectClass}
                          value={row.replyType ?? ''}
                          onChange={(e) => saveOutcome(row.contactId, { reply_type: (e.target.value || null) as ReplyType | null })}
                        >
                          <option value="">
                            {row.replyTypeSuggested ? `Sugestão: ${REPLY_TYPE_LABEL[row.replyTypeSuggested]}` : '—'}
                          </option>
                          {(Object.keys(REPLY_TYPE_LABEL) as ReplyType[]).map((key) => (
                            <option key={key} value={key}>{REPLY_TYPE_LABEL[key]}</option>
                          ))}
                        </select>
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
                        <select
                          className={selectClass}
                          value={row.lossReason ?? ''}
                          onChange={(e) => saveOutcome(row.contactId, { loss_reason: e.target.value || null })}
                        >
                          <option value="">{row.lossReasonSuggested ? `Sugestão: ${row.lossReasonSuggested}` : '—'}</option>
                          {LOSS_REASONS.map((reason) => (
                            <option key={reason} value={reason}>{reason}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Passe o mouse nos toques para ver data e detalhe. Verde = entregue ou lido; vermelho = barrado pela Meta ou bounce.
            “Sugestão” é o que o sistema inferiu; escolha um valor para registrar a classificação.
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
    </div>
  );
};

export default Pilot;
