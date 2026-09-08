import React, { useMemo, useState } from 'react';
import { RefreshCw, Sliders, Loader2, Users, Phone, Send, MessageSquare } from 'lucide-react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useApolloLeads } from '@/hooks/useApolloLeads';
import {
  apolloLeadsApi, LEAD_STATUS_LABEL, priorityLabel,
  type ApolloLead, type LeadStatus,
} from '@/services/apolloLeads';
import LeadDetails from '@/components/leads/LeadDetails';
import LeadSearchSettings from '@/components/leads/LeadSearchSettings';

const STATUS_FILTERS: Array<{ value: 'all' | LeadStatus; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'new', label: 'Novos' },
  { value: 'queued', label: 'Em disparo' },
  { value: 'contacted', label: 'Entregues' },
  { value: 'replied', label: 'Responderam' },
  { value: 'qualified', label: 'Qualificados' },
  { value: 'no_phone', label: 'Sem telefone' },
];

const Leads: React.FC = () => {
  const { leads, runs, settings, loading, error, reload } = useApolloLeads();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | LeadStatus>('all');
  const [selected, setSelected] = useState<ApolloLead | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (status !== 'all' && lead.status !== status) return false;
      if (!term) return true;
      return [lead.full_name, lead.company_name, lead.title, lead.email]
        .some((value) => (value ?? '').toLowerCase().includes(term));
    });
  }, [leads, search, status]);

  const stats = useMemo(() => ({
    total: leads.length,
    withPhone: leads.filter((lead) => Boolean(lead.phone_number)).length,
    dispatched: leads.filter((lead) => ['queued', 'contacted', 'replied', 'qualified'].includes(lead.status)).length,
    replied: leads.filter((lead) => ['replied', 'qualified', 'not_interested'].includes(lead.status)).length,
  }), [leads]);

  const lastRun = runs[0] ?? null;

  const runNow = async () => {
    setRunning(true);
    try {
      const result = await apolloLeadsApi.runNow();
      toast.success(`${result.new_leads} leads novos (${result.with_phone} com celular).`);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível buscar leads agora.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="operation-page custom-scrollbar">
      <div className="operation-container">
        <header className="operation-header">
          <div>
            <p className="via-eyebrow">Prospecção</p>
            <h1>Leads.</h1>
            <p>Indústrias de 50 a 500 funcionários no Sul e em SP, com decisores no comando — buscados toda semana.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="gap-2" onClick={() => setSettingsOpen(true)} disabled={!settings}>
              <Sliders className="w-4 h-4" /> Critérios
            </Button>
            <Button variant="primary" className="gap-2" onClick={runNow} disabled={running}>
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Buscar agora
            </Button>
          </div>
        </header>

        {settings?.paused && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 mb-6 text-sm">
            Captação pausada: {settings.paused_reason || 'a Apollo bloqueou as buscas.'} Ajuste em “Critérios” e salve para retomar.
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Leads na base', value: stats.total, icon: Users },
            { label: 'Com celular', value: stats.withPhone, icon: Phone },
            { label: 'Enviados', value: stats.dispatched, icon: Send },
            { label: 'Responderam', value: stats.replied, icon: MessageSquare },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <card.icon className="w-4 h-4" /> {card.label}
              </div>
              <p className="text-2xl font-semibold mt-2">{card.value}</p>
            </div>
          ))}
        </div>

        {lastRun && (
          <p className="text-xs text-muted-foreground mb-6">
            Última busca em {new Date(lastRun.started_at).toLocaleString('pt-BR')} —{' '}
            {lastRun.status === 'failed'
              ? `falhou: ${lastRun.error_message ?? 'erro desconhecido'}`
              : `${lastRun.new_leads} leads novos, ${lastRun.with_phone} com celular`}.
            {' '}A próxima roda automaticamente na segunda-feira.
          </p>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, empresa ou cargo…"
            className="flex-1 min-w-[220px] rounded-lg border border-border bg-background p-2 text-sm"
          />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as 'all' | LeadStatus)}
            className="rounded-lg border border-border bg-background p-2 text-sm"
          >
            {STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>

        {error && <p className="text-sm text-destructive mb-4">{error}</p>}
        {loading && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando leads…
          </p>
        )}

        {!loading && filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum lead por aqui ainda. Use “Buscar agora” para trazer a primeira leva da Apollo.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {filtered.map((lead) => (
            <button
              key={lead.id}
              onClick={() => setSelected(lead)}
              className="w-full text-left rounded-xl border border-border p-4 hover:border-primary/50 transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{lead.full_name || 'Sem nome'}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {lead.title || '—'} · {lead.company_name || 'empresa não informada'}
                    {lead.company_employees ? ` · ${lead.company_employees} func.` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[lead.city, lead.state].filter(Boolean).join(', ') || '—'} · {lead.phone_number || 'sem telefone'} · {lead.email || 'sem e-mail'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{priorityLabel(lead.priority_score)}</Badge>
                  <Badge variant="outline">{LEAD_STATUS_LABEL[lead.status]}</Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <LeadDetails lead={selected} onClose={() => setSelected(null)} onSaved={reload} />
      )}
      {settingsOpen && settings && (
        <LeadSearchSettings settings={settings} onClose={() => setSettingsOpen(false)} onSaved={reload} />
      )}
    </div>
  );
};

export default Leads;
