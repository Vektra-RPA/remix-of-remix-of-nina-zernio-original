import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, Send, Users, Gauge, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/Button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { whatsappTemplatesApi } from '@/services/whatsappTemplates';
import type { MetaTemplate } from '../../../supabase/functions/_shared/whatsapp-templates';
import { countBodyVariables, renderTemplateText } from '../../../supabase/functions/_shared/whatsapp-templates';
import { broadcastsApi, messagesPerDay, type DispatchProfile, type RecipientCandidate } from '@/services/broadcasts';

const CONTACT_NAME_TOKEN = '{{contact.name}}';

interface Props {
  open: boolean;
  onClose: () => void;
  profiles: DispatchProfile[];
  onCreated: (campaignId: string) => void;
}

const STEPS = [
  { title: 'Campanha', icon: FileText },
  { title: 'Mensagem', icon: Send },
  { title: 'Destinatários', icon: Users },
  { title: 'Ritmo', icon: Gauge },
];

const CampaignWizard: React.FC<Props> = ({ open, onClose, profiles, onCreated }) => {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<Array<{ key: string; label: string }>>([]);
  const [stageOptions, setStageOptions] = useState<Array<{ id: string; title: string }>>([]);
  const [recipients, setRecipients] = useState<RecipientCandidate[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [profileId, setProfileId] = useState<string>('');
  const [pace, setPace] = useState({ delay_min_s: 30, delay_max_s: 60, batch_size: 20, pause_between_batches_min: 10, pause_between_batches_max: 15 });
  const [saving, setSaving] = useState(false);

  const template = useMemo(() => templates.find((item) => item.name === templateName) ?? null, [templates, templateName]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    whatsappTemplatesApi.list()
      .then((list) => {
        setTemplates(list.filter((item) => item.status?.toUpperCase() === 'APPROVED'));
        setTemplatesError(null);
      })
      .catch((error) => setTemplatesError(error instanceof Error ? error.message : 'Falha ao carregar templates.'));

    supabase.from('tag_definitions').select('key, label').eq('is_active', true)
      .then(({ data }) => setTagOptions((data ?? []) as Array<{ key: string; label: string }>));
    supabase.from('pipeline_stages').select('id, title').eq('is_active', true).order('position')
      .then(({ data }) => setStageOptions((data ?? []) as Array<{ id: string; title: string }>));
  }, [open]);

  useEffect(() => {
    if (!template) return;
    setParams(Array.from({ length: countBodyVariables(template.bodyText) }, () => CONTACT_NAME_TOKEN));
  }, [template]);

  useEffect(() => {
    if (!open || profiles.length === 0 || profileId) return;
    const chosen = profiles.find((item) => item.is_default) ?? profiles[0];
    setProfileId(chosen.id);
    setPace({
      delay_min_s: chosen.delay_min_s,
      delay_max_s: chosen.delay_max_s,
      batch_size: chosen.batch_size,
      pause_between_batches_min: chosen.pause_between_batches_min,
      pause_between_batches_max: chosen.pause_between_batches_max,
    });
  }, [open, profiles, profileId]);

  const loadRecipients = async () => {
    setLoadingRecipients(true);
    try {
      setRecipients(await broadcastsApi.findRecipients({ tags, stageIds }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao buscar contatos.');
    } finally {
      setLoadingRecipients(false);
    }
  };

  useEffect(() => {
    if (open && step === 2) loadRecipients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, tags, stageIds]);

  const preview = template
    ? renderTemplateText(template.bodyText, params.map((value) => (value === CONTACT_NAME_TOKEN ? 'Maria' : value)))
    : '';

  const canAdvance = [
    name.trim().length > 1,
    !!template,
    recipients.length > 0,
    pace.batch_size > 0,
  ][step];

  const handleCreate = async () => {
    if (!template) return;
    setSaving(true);
    try {
      const campaignId = await broadcastsApi.createCampaign({
        name: name.trim(),
        template_name: template.name,
        template_language: template.language,
        template_body: template.bodyText,
        template_params: params,
        profile_id: profileId || null,
        ...pace,
        recipients,
      });
      toast.success('Campanha criada como rascunho.');
      onCreated(campaignId);
      onClose();
      setName('');
      setTemplateName('');
      setRecipients([]);
      setTags([]);
      setStageIds([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar a campanha.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (list: string[], value: string, set: (next: string[]) => void) =>
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
          <DialogDescription>Envie um template aprovado para contatos do CRM no ritmo que você definir.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-4">
          {STEPS.map((item, index) => (
            <div key={item.title} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border ${index === step ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>
              <item.icon className="w-3.5 h-3.5" />
              {item.title}
            </div>
          ))}
        </div>

        <div className="min-h-[280px] max-h-[50vh] overflow-y-auto pr-1 space-y-4">
          {step === 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome da campanha</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Reativação — base fria" />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              {templatesError && <p className="text-sm text-destructive">{templatesError}</p>}
              {!templatesError && templates.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum template aprovado disponível. Crie e aprove um em Configurações → Canais.</p>
              )}
              <div className="grid gap-2">
                {templates.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTemplateName(item.name)}
                    className={`text-left rounded-lg border p-3 transition-colors ${templateName === item.name ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{item.name}</span>
                      <Badge variant="secondary">{item.language}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.bodyText}</p>
                  </button>
                ))}
              </div>

              {template && params.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Variáveis</label>
                  {params.map((value, index) => (
                    <Input
                      key={index}
                      value={value}
                      onChange={(event) => setParams(params.map((item, position) => (position === index ? event.target.value : item)))}
                      placeholder="Texto fixo ou {{contact.name}}"
                    />
                  ))}
                </div>
              )}

              {template && (
                <div className="rounded-lg border border-border p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">Pré-visualização</p>
                  <p className="text-sm whitespace-pre-wrap">{preview}</p>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {tagOptions.map((tag) => (
                    <button key={tag.key} type="button" onClick={() => toggle(tags, tag.key, setTags)}
                      className={`text-xs px-2.5 py-1 rounded-full border ${tags.includes(tag.key) ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                      {tag.label}
                    </button>
                  ))}
                  {tagOptions.length === 0 && <span className="text-xs text-muted-foreground">Sem tags cadastradas.</span>}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Etapa do funil</p>
                <div className="flex flex-wrap gap-2">
                  {stageOptions.map((stage) => (
                    <button key={stage.id} type="button" onClick={() => toggle(stageIds, stage.id, setStageIds)}
                      className={`text-xs px-2.5 py-1 rounded-full border ${stageIds.includes(stage.id) ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                      {stage.title}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                {loadingRecipients ? (
                  <span className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Buscando contatos…</span>
                ) : (
                  <>
                    <p className="text-sm font-medium">{recipients.length} contato(s) selecionado(s)</p>
                    <p className="text-xs text-muted-foreground">Somente contatos com telefone e não bloqueados. Sem filtros, entra toda a base.</p>
                  </>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid gap-2">
                {profiles.map((item) => (
                  <button key={item.id} type="button"
                    onClick={() => {
                      setProfileId(item.id);
                      setPace({
                        delay_min_s: item.delay_min_s,
                        delay_max_s: item.delay_max_s,
                        batch_size: item.batch_size,
                        pause_between_batches_min: item.pause_between_batches_min,
                        pause_between_batches_max: item.pause_between_batches_max,
                      });
                    }}
                    className={`text-left rounded-lg border p-3 ${profileId === item.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{item.name}</span>
                      <span className="text-xs text-muted-foreground">~{messagesPerDay(item)} msgs/dia</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {([
                  ['delay_min_s', 'Intervalo mínimo (s)'],
                  ['delay_max_s', 'Intervalo máximo (s)'],
                  ['batch_size', 'Mensagens por lote'],
                  ['pause_between_batches_min', 'Pausa mínima (min)'],
                  ['pause_between_batches_max', 'Pausa máxima (min)'],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground">{label}</label>
                    <Input type="number" min={0} value={pace[key]}
                      onChange={(event) => setPace({ ...pace, [key]: Number(event.target.value) })} />
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-border p-3 bg-muted/30 text-sm">
                <p><strong>{recipients.length}</strong> destinatários · template <strong>{template?.name}</strong></p>
                <p className="text-xs text-muted-foreground mt-1">Ritmo estimado: ~{messagesPerDay(pace)} mensagens por dia.</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={() => (step === 0 ? onClose() : setStep(step - 1))} className="gap-2">
            <ChevronLeft className="w-4 h-4" /> {step === 0 ? 'Cancelar' : 'Voltar'}
          </Button>
          {step < 3 ? (
            <Button variant="primary" disabled={!canAdvance} onClick={() => setStep(step + 1)} className="gap-2">
              Avançar <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button variant="primary" disabled={saving || !canAdvance} onClick={handleCreate} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Criar campanha
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CampaignWizard;
