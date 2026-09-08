import React, { useMemo, useState } from 'react';
import { Play, Pause, X, Plus, Send, Users, CheckCircle2, AlertTriangle, Gauge, Loader2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useBroadcasts } from '@/hooks/useBroadcasts';
import { useDispatchProfiles } from '@/hooks/useDispatchProfiles';
import { broadcastsApi, messagesPerDay, type BroadcastCampaign } from '@/services/broadcasts';
import CampaignWizard from '@/components/broadcasts/CampaignWizard';
import CampaignDetails from '@/components/broadcasts/CampaignDetails';

const STATUS_LABEL: Record<BroadcastCampaign['status'], string> = {
  draft: 'Rascunho',
  queued: 'Na fila',
  sending: 'Enviando',
  paused: 'Pausada',
  completed: 'Concluída',
  failed: 'Com erro',
  canceled: 'Cancelada',
};

const Dispatch: React.FC = () => {
  const { campaigns, loading, reload } = useBroadcasts();
  const { profiles } = useDispatchProfiles();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selected, setSelected] = useState<BroadcastCampaign | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const stats = useMemo(() => ({
    total: campaigns.length,
    active: campaigns.filter((item) => item.status === 'sending' || item.status === 'queued').length,
    sent: campaigns.reduce((sum, item) => sum + item.sent_count, 0),
    failed: campaigns.reduce((sum, item) => sum + item.failed_count, 0),
  }), [campaigns]);

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try {
      await action();
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ação não concluída.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="operation-page custom-scrollbar">
      <div className="operation-container">
        <header className="operation-header">
          <div>
            <p className="via-eyebrow">Campanhas</p>
            <h1>Disparos.</h1>
            <p>Envie templates aprovados para a sua base do CRM com ritmo controlado.</p>
          </div>
          <Button variant="primary" className="gap-2" onClick={() => setWizardOpen(true)}>
            <Plus className="w-4 h-4" /> Nova campanha
          </Button>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Campanhas', value: stats.total, icon: Send },
            { label: 'Em andamento', value: stats.active, icon: Users },
            { label: 'Mensagens enviadas', value: stats.sent, icon: CheckCircle2 },
            { label: 'Falhas', value: stats.failed, icon: AlertTriangle },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <card.icon className="w-4 h-4" /> {card.label}
              </div>
              <p className="text-2xl font-semibold mt-2">{card.value}</p>
            </div>
          ))}
        </div>

        <section className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando campanhas…</p>}
          {!loading && campaigns.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma campanha ainda. Crie a primeira para começar a disparar.</p>
            </div>
          )}

          {campaigns.map((campaign) => {
            const done = campaign.sent_count + campaign.failed_count;
            const percent = campaign.total_recipients ? Math.round((done / campaign.total_recipients) * 100) : 0;
            const busy = busyId === campaign.id;
            return (
              <div key={campaign.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" className="text-left min-w-0" onClick={() => setSelected(campaign)}>
                    <p className="font-medium truncate">{campaign.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {campaign.template_name} · {campaign.total_recipients} destinatários · ~{messagesPerDay(campaign)} msgs/dia
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    <Badge variant={campaign.status === 'failed' ? 'destructive' : 'secondary'}>{STATUS_LABEL[campaign.status]}</Badge>
                    {(campaign.status === 'draft' || campaign.status === 'paused') && (
                      <Button variant="ghost" size="sm" disabled={busy} className="gap-1"
                        onClick={() => run(campaign.id, () => campaign.status === 'draft' ? broadcastsApi.start(campaign.id) : broadcastsApi.resume(campaign.id))}>
                        <Play className="w-4 h-4" /> {campaign.status === 'draft' ? 'Iniciar' : 'Retomar'}
                      </Button>
                    )}
                    {(campaign.status === 'sending' || campaign.status === 'queued') && (
                      <Button variant="ghost" size="sm" disabled={busy} className="gap-1"
                        onClick={() => run(campaign.id, () => broadcastsApi.pause(campaign.id))}>
                        <Pause className="w-4 h-4" /> Pausar
                      </Button>
                    )}
                    {!['completed', 'canceled'].includes(campaign.status) && (
                      <Button variant="ghost" size="sm" disabled={busy} className="gap-1"
                        onClick={() => run(campaign.id, () => broadcastsApi.cancel(campaign.id))}>
                        <X className="w-4 h-4" /> Cancelar
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {campaign.sent_count} enviadas · {campaign.failed_count} falhas · {percent}%
                </p>
              </div>
            );
          })}
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-3"><Gauge className="w-4 h-4" /> Perfis de velocidade</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {profiles.map((profile) => (
              <div key={profile.id} className="rounded-xl border border-border p-4">
                <p className="text-sm font-medium">{profile.name}</p>
                <p className="text-xs text-muted-foreground">{profile.description}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {profile.delay_min_s}-{profile.delay_max_s}s entre mensagens · lotes de {profile.batch_size} · pausa {profile.pause_between_batches_min}-{profile.pause_between_batches_max} min
                </p>
                <p className="text-xs mt-1">~{messagesPerDay(profile)} mensagens/dia</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <CampaignWizard open={wizardOpen} onClose={() => setWizardOpen(false)} profiles={profiles} onCreated={() => reload()} />
      <CampaignDetails campaign={selected} onClose={() => setSelected(null)} />
    </div>
  );
};

export default Dispatch;
