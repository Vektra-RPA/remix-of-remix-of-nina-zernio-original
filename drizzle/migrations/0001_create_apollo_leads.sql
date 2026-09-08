CREATE TABLE public.apollo_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apollo_person_id text NOT NULL UNIQUE,
  full_name text,
  first_name text,
  last_name text,
  title text,
  seniority text,
  email text,
  email_status text,
  phone_number text,
  linkedin_url text,
  city text,
  state text,
  country text,
  company_name text,
  company_domain text,
  company_industry text,
  company_employees integer,
  company_city text,
  company_state text,
  priority_score integer NOT NULL DEFAULT 0,
  score_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'new',
  disqualify_reason text,
  notes text,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.broadcast_campaigns(id) ON DELETE SET NULL,
  run_id uuid,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  contacted_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apollo_leads TO authenticated;
GRANT ALL ON public.apollo_leads TO service_role;
ALTER TABLE public.apollo_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can access apollo_leads" ON public.apollo_leads
  FOR ALL TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX idx_apollo_leads_status ON public.apollo_leads (status);
CREATE INDEX idx_apollo_leads_fetched_at ON public.apollo_leads (fetched_at DESC);
CREATE INDEX idx_apollo_leads_campaign ON public.apollo_leads (campaign_id);

CREATE TABLE public.apollo_search_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running',
  trigger_source text NOT NULL DEFAULT 'cron',
  requested integer NOT NULL DEFAULT 0,
  fetched integer NOT NULL DEFAULT 0,
  new_leads integer NOT NULL DEFAULT 0,
  with_phone integer NOT NULL DEFAULT 0,
  campaign_id uuid REFERENCES public.broadcast_campaigns(id) ON DELETE SET NULL,
  error_message text,
  locked_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apollo_search_runs TO authenticated;
GRANT ALL ON public.apollo_search_runs TO service_role;
ALTER TABLE public.apollo_search_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can access apollo_search_runs" ON public.apollo_search_runs
  FOR ALL TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX idx_apollo_runs_started ON public.apollo_search_runs (started_at DESC);

CREATE TABLE public.apollo_search_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titles text[] NOT NULL DEFAULT ARRAY['CEO','Diretor','Diretor Comercial','Diretor Industrial','Director','Chief Executive Officer'],
  states text[] NOT NULL DEFAULT ARRAY['São Paulo, Brazil','Rio Grande do Sul, Brazil','Santa Catarina, Brazil','Paraná, Brazil'],
  industries text[] NOT NULL DEFAULT ARRAY['manufacturing','industrial','machinery'],
  employees_min integer NOT NULL DEFAULT 50,
  employees_max integer NOT NULL DEFAULT 500,
  weekly_quota integer NOT NULL DEFAULT 80,
  auto_dispatch boolean NOT NULL DEFAULT true,
  template_name text,
  template_language text,
  template_body text,
  template_params jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile_id uuid REFERENCES public.dispatch_profiles(id) ON DELETE SET NULL,
  paused boolean NOT NULL DEFAULT false,
  paused_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apollo_search_settings TO authenticated;
GRANT ALL ON public.apollo_search_settings TO service_role;
ALTER TABLE public.apollo_search_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can access apollo_search_settings" ON public.apollo_search_settings
  FOR ALL TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION public.touch_apollo_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apollo_leads_updated
  BEFORE UPDATE ON public.apollo_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_apollo_updated_at();

CREATE TRIGGER trg_apollo_settings_updated
  BEFORE UPDATE ON public.apollo_search_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_apollo_updated_at();
