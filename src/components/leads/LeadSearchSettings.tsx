import React, { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { toast } from 'sonner';
import { apolloLeadsApi, type ApolloSettings } from '@/services/apolloLeads';
import { whatsappTemplatesApi } from '@/services/whatsappTemplates';
import { useDispatchProfiles } from '@/hooks/useDispatchProfiles';
import type { MetaTemplate } from '../../../supabase/functions/_shared/whatsapp-templates';
import { countBodyVariables } from '../../../supabase/functions/_shared/whatsapp-templates';

const CONTACT_NAME_TOKEN = '{{contact.name}}';

interface Props {
  settings: ApolloSettings;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const LeadSearchSettings: React.FC<Props> = ({ settings, onClose, onSaved }) => {
  const { profiles } = useDispatchProfiles();
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [form, setForm] = useState({
    titles: settings.titles.join(', '),
    states: settings.states.join(', '),
    industries: settings.industries.join(', '),
    employees_min: settings.employees_min,
    employees_max: settings.employees_max,
    weekly_quota: settings.weekly_quota,
    auto_dispatch: settings.auto_dispatch,
    reveal_phones: settings.reveal_phones,
    template_name: settings.template_name ?? '',
    profile_id: settings.profile_id ?? '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    whatsappTemplatesApi.list()
      .then((list) => setTemplates(list.filter((item) => item.status === 'APPROVED')))
      .catch((error) => setTemplatesError(error instanceof Error ? error.message : 'Falha ao carregar templates.'));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const template = templates.find((item) => item.name === form.template_name) ?? null;
      await apolloLeadsApi.saveSettings(settings.id, {
        titles: form.titles.split(',').map((item) => item.trim()).filter(Boolean),
        states: form.states.split(',').map((item) => item.trim()).filter(Boolean),
        industries: form.industries.split(',').map((item) => item.trim()).filter(Boolean),
        employees_min: Number(form.employees_min),
        employees_max: Number(form.employees_max),
        weekly_quota: Number(form.weekly_quota),
        auto_dispatch: form.auto_dispatch,
        reveal_phones: form.reveal_phones,
        template_name: template?.name ?? null,
        template_language: template?.language ?? null,
        template_body: template?.bodyText ?? null,
        template_params: template
          ? Array.from({ length: countBodyVariables(template.bodyText) }, () => CONTACT_NAME_TOKEN)
          : [],
        profile_id: form.profile_id || null,
        paused: false,
        paused_reason: null,
      });
      toast.success('Critérios salvos.');
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full rounded-lg border border-border bg-background p-2 text-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 custom-scrollbar">
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="via-eyebrow">Captação</p>
            <h2 className="text-xl font-semibold">Critérios da busca semanal</h2>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid gap-4">
          <label className="text-sm space-y-1">
            <span className="font-medium">Cargos (separados por vírgula)</span>
            <input className={field} value={form.titles} onChange={(e) => setForm({ ...form, titles: e.target.value })} />
          </label>
          <label className="text-sm space-y-1">
            <span className="font-medium">Estados / regiões</span>
            <input className={field} value={form.states} onChange={(e) => setForm({ ...form, states: e.target.value })} />
          </label>
          <label className="text-sm space-y-1">
            <span className="font-medium">Palavras-chave do setor</span>
            <input className={field} value={form.industries} onChange={(e) => setForm({ ...form, industries: e.target.value })} />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm space-y-1">
              <span className="font-medium">Mín. funcionários</span>
              <input type="number" className={field} value={form.employees_min}
                onChange={(e) => setForm({ ...form, employees_min: Number(e.target.value) })} />
            </label>
            <label className="text-sm space-y-1">
              <span className="font-medium">Máx. funcionários</span>
              <input type="number" className={field} value={form.employees_max}
                onChange={(e) => setForm({ ...form, employees_max: Number(e.target.value) })} />
            </label>
            <label className="text-sm space-y-1">
              <span className="font-medium">Leads por semana</span>
              <input type="number" className={field} value={form.weekly_quota}
                onChange={(e) => setForm({ ...form, weekly_quota: Number(e.target.value) })} />
            </label>
          </div>

          <label className="text-sm space-y-1">
            <span className="font-medium">Template aprovado do disparo automático</span>
            <select className={field} value={form.template_name}
              onChange={(e) => setForm({ ...form, template_name: e.target.value })}>
              <option value="">Nenhum — só listar os leads</option>
              {templates.map((item) => (
                <option key={item.name} value={item.name}>{item.name} ({item.language})</option>
              ))}
            </select>
            {templatesError && <span className="text-xs text-destructive">{templatesError}</span>}
          </label>

          <label className="text-sm space-y-1">
            <span className="font-medium">Perfil de velocidade</span>
            <select className={field} value={form.profile_id}
              onChange={(e) => setForm({ ...form, profile_id: e.target.value })}>
              <option value="">Ritmo padrão</option>
              {profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.auto_dispatch}
              onChange={(e) => setForm({ ...form, auto_dispatch: e.target.checked })} />
            Enviar automaticamente para quem tiver celular
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.reveal_phones}
              onChange={(e) => setForm({ ...form, reveal_phones: e.target.checked })} />
            Pedir à Apollo o celular de quem veio sem telefone (consome créditos)
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar critérios'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LeadSearchSettings;
