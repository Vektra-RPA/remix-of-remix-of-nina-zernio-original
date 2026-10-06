import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Loader2, Users, Send, MessageSquare, CalendarCheck, Megaphone, LifeBuoy, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { pilotApi, type PilotOverview } from '@/services/pilot';

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const Pilot: React.FC = () => {
  const [data, setData] = useState<PilotOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setData(await pilotApi.fetchOverview());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível carregar o painel do piloto.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
