import React, { useState } from 'react';
import { X, Building2, Mail, Phone, Linkedin, MapPin, Users, Loader2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  apolloLeadsApi, LEAD_STATUS_LABEL, priorityLabel,
  type ApolloLead, type LeadStatus,
} from '@/services/apolloLeads';

interface Props {
  lead: ApolloLead;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const CLASSIFICATIONS: Array<{ value: LeadStatus; label: string }> = [
  { value: 'qualified', label: 'Qualificado' },
  { value: 'not_interested', label: 'Sem interesse' },
  { value: 'discarded', label: 'Descartado' },
];

const LeadDetails: React.FC<Props> = ({ lead, onClose, onSaved }) => {
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [reason, setReason] = useState(lead.disqualify_reason ?? '');
  const [saving, setSaving] = useState(false);

  const save = async (status?: LeadStatus) => {
    setSaving(true);
    try {
      await apolloLeadsApi.updateLead(lead.id, {
        notes,
        disqualify_reason: reason || null,
        ...(status ? { status } : {}),
      });
      toast.success(status ? `Lead marcado como ${LEAD_STATUS_LABEL[status]}.` : 'Anotações salvas.');
      await onSaved();
      if (status) onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-sm">
      <aside className="w-full max-w-md h-full overflow-y-auto border-l border-border bg-card p-6 custom-scrollbar">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="via-eyebrow">Lead</p>
            <h2 className="text-xl font-semibold">{lead.full_name || 'Sem nome'}</h2>
            <p className="text-sm text-muted-foreground">{lead.title || '—'}</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <Badge variant="outline">{LEAD_STATUS_LABEL[lead.status]}</Badge>
          <Badge variant="secondary">Prioridade {priorityLabel(lead.priority_score)}</Badge>
          {!lead.phone_number && <Badge variant="outline">Sem telefone</Badge>}
        </div>

        <div className="space-y-3 text-sm mb-6">
          <p className="flex items-center gap-2"><Building2 className="w-4 h-4 text-muted-foreground" /> {lead.company_name || '—'}</p>
          <p className="flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" /> {lead.company_employees ?? '—'} funcionários · {lead.company_industry || 'setor não informado'}</p>
          <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" /> {[lead.city, lead.state].filter(Boolean).join(', ') || '—'}</p>
          <p className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" /> {lead.email || '—'}</p>
          <p className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /> {lead.phone_number || 'Sem telefone'}</p>
          {lead.linkedin_url && (
            <a href={lead.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline">
              <Linkedin className="w-4 h-4" /> Ver no LinkedIn
            </a>
          )}
        </div>

        {lead.score_reasons.length > 0 && (
          <div className="rounded-lg border border-border p-3 mb-6">
            <p className="text-xs text-muted-foreground mb-2">Por que a prioridade é {priorityLabel(lead.priority_score)}</p>
            <ul className="text-sm space-y-1 list-disc pl-4">
              {lead.score_reasons.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}

        <div className="space-y-2 mb-4">
          <label className="text-sm font-medium" htmlFor="lead-notes">Anotações da conversa</label>
          <textarea
            id="lead-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            className="w-full rounded-lg border border-border bg-background p-3 text-sm"
            placeholder="O que o lead respondeu, próximos passos…"
          />
        </div>

        <div className="space-y-2 mb-6">
          <label className="text-sm font-medium" htmlFor="lead-reason">Motivo (se descartar)</label>
          <input
            id="lead-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-lg border border-border bg-background p-2 text-sm"
            placeholder="Ex.: fora do perfil, sem orçamento"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={saving} onClick={() => save()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar anotações'}
          </Button>
          {CLASSIFICATIONS.map((item) => (
            <Button key={item.value} variant="primary" disabled={saving} onClick={() => save(item.value)}>
              {item.label}
            </Button>
          ))}
        </div>
      </aside>
    </div>
  );
};

export default LeadDetails;
