import { supabase } from '@/integrations/supabase/client';

export interface DispatchProfile {
  id: string;
  name: string;
  description: string;
  delay_min_s: number;
  delay_max_s: number;
  batch_size: number;
  pause_between_batches_min: number;
  pause_between_batches_max: number;
  is_default: boolean;
  created_at: string;
}

export type DispatchProfileInput = Omit<DispatchProfile, 'id' | 'created_at' | 'is_default'> & {
  is_default?: boolean;
};

export interface BroadcastCampaign {
  id: string;
  name: string;
  template_name: string;
  template_language: string;
  template_body: string;
  template_params: string[];
  profile_id: string | null;
  delay_min_s: number;
  delay_max_s: number;
  batch_size: number;
  pause_between_batches_min: number;
  pause_between_batches_max: number;
  status: 'draft' | 'queued' | 'sending' | 'paused' | 'completed' | 'failed' | 'canceled';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  next_batch_at: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface BroadcastRecipient {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  phone_number: string;
  contact_name: string | null;
  status: 'pending' | 'sent' | 'failed';
  error_message: string | null;
  sent_at: string | null;
}

export interface RecipientCandidate {
  id: string;
  name: string | null;
  call_name: string | null;
  phone_number: string | null;
  tags: string[] | null;
}

/** Estimativa de mensagens por dia considerando 10h de operação. */
export function messagesPerDay(profile: {
  delay_min_s: number;
  delay_max_s: number;
  batch_size: number;
  pause_between_batches_min: number;
  pause_between_batches_max: number;
}): number {
  const avgDelay = (profile.delay_min_s + profile.delay_max_s) / 2;
  const batchTime = avgDelay * profile.batch_size;
  const avgPause = ((profile.pause_between_batches_min + profile.pause_between_batches_max) / 2) * 60;
  const cycleTime = batchTime + avgPause;
  if (cycleTime <= 0) return 0;
  const cycles = (10 * 3600) / cycleTime;
  return Math.round(cycles * profile.batch_size);
}

export const broadcastsApi = {
  async listProfiles(): Promise<DispatchProfile[]> {
    const { data, error } = await supabase
      .from('dispatch_profiles').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DispatchProfile[];
  },

  async createProfile(input: DispatchProfileInput): Promise<void> {
    const { error } = await supabase.from('dispatch_profiles').insert(input);
    if (error) throw error;
  },

  async updateProfile(id: string, input: Partial<DispatchProfileInput>): Promise<void> {
    const { error } = await supabase.from('dispatch_profiles').update(input).eq('id', id);
    if (error) throw error;
  },

  async deleteProfile(id: string): Promise<void> {
    const { error } = await supabase.from('dispatch_profiles').delete().eq('id', id);
    if (error) throw error;
  },

  async listCampaigns(): Promise<BroadcastCampaign[]> {
    const { data, error } = await supabase
      .from('broadcast_campaigns').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      ...row,
      template_params: Array.isArray(row.template_params) ? (row.template_params as string[]) : [],
    })) as BroadcastCampaign[];
  },

  async listRecipients(campaignId: string): Promise<BroadcastRecipient[]> {
    const { data, error } = await supabase
      .from('broadcast_recipients').select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .limit(1000);
    if (error) throw error;
    return (data ?? []) as BroadcastRecipient[];
  },

  /** Contatos elegíveis: com telefone, não bloqueados, filtrados por tags e etapa. */
  async findRecipients(filters: { tags: string[]; stageIds: string[] }): Promise<RecipientCandidate[]> {
    let contactIdsFromStages: string[] | null = null;
    if (filters.stageIds.length > 0) {
      const { data, error } = await supabase
        .from('deals').select('contact_id').in('stage_id', filters.stageIds).not('contact_id', 'is', null);
      if (error) throw error;
      contactIdsFromStages = Array.from(new Set((data ?? []).map((row) => row.contact_id as string)));
      if (contactIdsFromStages.length === 0) return [];
    }

    let query = supabase
      .from('contacts')
      .select('id, name, call_name, phone_number, tags')
      .not('phone_number', 'is', null)
      .or('is_blocked.is.null,is_blocked.eq.false')
      .order('last_activity', { ascending: false })
      .limit(1000);

    if (filters.tags.length > 0) query = query.overlaps('tags', filters.tags);
    if (contactIdsFromStages) query = query.in('id', contactIdsFromStages);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as RecipientCandidate[];
  },

  async createCampaign(input: {
    name: string;
    template_name: string;
    template_language: string;
    template_body: string;
    template_params: string[];
    profile_id: string | null;
    delay_min_s: number;
    delay_max_s: number;
    batch_size: number;
    pause_between_batches_min: number;
    pause_between_batches_max: number;
    recipients: RecipientCandidate[];
  }): Promise<string> {
    const { recipients, ...campaign } = input;
    const { data, error } = await supabase
      .from('broadcast_campaigns')
      .insert({ ...campaign, status: 'draft', total_recipients: recipients.length })
      .select('id')
      .single();
    if (error) throw error;
    const campaignId = (data as { id: string }).id;

    const rows = recipients.map((contact) => ({
      campaign_id: campaignId,
      contact_id: contact.id,
      phone_number: contact.phone_number ?? '',
      contact_name: contact.call_name || contact.name,
    }));
    for (let index = 0; index < rows.length; index += 500) {
      const { error: insertError } = await supabase
        .from('broadcast_recipients').insert(rows.slice(index, index + 500));
      if (insertError) throw insertError;
    }
    return campaignId;
  },

  async start(campaignId: string): Promise<void> {
    const { error } = await supabase.functions.invoke('broadcast-processor', {
      body: { campaign_id: campaignId },
    });
    if (error) throw new Error(error.message || 'Não foi possível iniciar a campanha.');
  },

  async pause(campaignId: string): Promise<void> {
    const { error } = await supabase
      .from('broadcast_campaigns').update({ status: 'paused', next_batch_at: null }).eq('id', campaignId);
    if (error) throw error;
  },

  async resume(campaignId: string): Promise<void> {
    const { error } = await supabase
      .from('broadcast_campaigns').update({ status: 'queued', next_batch_at: null }).eq('id', campaignId);
    if (error) throw error;
    await broadcastsApi.start(campaignId);
  },

  async cancel(campaignId: string): Promise<void> {
    const { error } = await supabase
      .from('broadcast_campaigns')
      .update({ status: 'canceled', next_batch_at: null, completed_at: new Date().toISOString() })
      .eq('id', campaignId);
    if (error) throw error;
  },
};
