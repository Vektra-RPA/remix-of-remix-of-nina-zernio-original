import { supabase } from '@/integrations/supabase/client';

export type LeadStatus =
  | 'new' | 'queued' | 'contacted' | 'replied'
  | 'qualified' | 'not_interested' | 'discarded' | 'no_phone' | 'failed';

export interface ApolloLead {
  id: string;
  apollo_person_id: string;
  full_name: string | null;
  title: string | null;
  seniority: string | null;
  email: string | null;
  email_status: string | null;
  phone_number: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  company_employees: number | null;
  priority_score: number;
  score_reasons: string[];
  status: LeadStatus;
  disqualify_reason: string | null;
  notes: string | null;
  contact_id: string | null;
  campaign_id: string | null;
  fetched_at: string;
  contacted_at: string | null;
  replied_at: string | null;
}

export interface ApolloRun {
  id: string;
  status: 'running' | 'success' | 'failed';
  trigger_source: string;
  requested: number;
  fetched: number;
  new_leads: number;
  with_phone: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface ApolloSettings {
  id: string;
  titles: string[];
  states: string[];
  industries: string[];
  employees_min: number;
  employees_max: number;
  weekly_quota: number;
  auto_dispatch: boolean;
  reveal_phones: boolean;
  template_name: string | null;
  template_language: string | null;
  template_body: string | null;
  template_params: string[];
  profile_id: string | null;
  paused: boolean;
  paused_reason: string | null;
}

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Novo',
  queued: 'Em disparo',
  contacted: 'Entregue',
  replied: 'Respondeu',
  qualified: 'Qualificado',
  not_interested: 'Sem interesse',
  discarded: 'Descartado',
  no_phone: 'Sem telefone',
  failed: 'Falha no envio',
};

export function priorityLabel(score: number): 'Alta' | 'Média' | 'Baixa' {
  if (score >= 75) return 'Alta';
  if (score >= 55) return 'Média';
  return 'Baixa';
}

export const apolloLeadsApi = {
  async listLeads(): Promise<ApolloLead[]> {
    const { data, error } = await supabase
      .from('apollo_leads')
      .select('*')
      .order('priority_score', { ascending: false })
      .order('fetched_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      ...row,
      score_reasons: Array.isArray(row.score_reasons) ? (row.score_reasons as string[]) : [],
    })) as ApolloLead[];
  },

  async listRuns(): Promise<ApolloRun[]> {
    const { data, error } = await supabase
      .from('apollo_search_runs').select('*').order('started_at', { ascending: false }).limit(10);
    if (error) throw error;
    return (data ?? []) as ApolloRun[];
  },

  async getSettings(): Promise<ApolloSettings | null> {
    const { data, error } = await supabase
      .from('apollo_search_settings').select('*').limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      ...data,
      template_params: Array.isArray(data.template_params) ? (data.template_params as string[]) : [],
    } as ApolloSettings;
  },

  async saveSettings(id: string, input: Partial<ApolloSettings>): Promise<void> {
    const { error } = await supabase.from('apollo_search_settings').update(input).eq('id', id);
    if (error) throw error;
  },

  async updateLead(id: string, input: Partial<Pick<ApolloLead, 'status' | 'disqualify_reason' | 'notes'>>): Promise<void> {
    const { error } = await supabase.from('apollo_leads').update(input).eq('id', id);
    if (error) throw error;
  },

  async runNow(): Promise<{ new_leads: number; with_phone: number }> {
    const { data, error } = await supabase.functions.invoke('apollo-lead-sync', { body: { source: 'manual' } });
    if (error) throw new Error(error.message || 'Não foi possível buscar leads agora.');
    return data as { new_leads: number; with_phone: number };
  },
};
