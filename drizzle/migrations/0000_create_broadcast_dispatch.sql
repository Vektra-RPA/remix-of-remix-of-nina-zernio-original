CREATE TABLE public.dispatch_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  delay_min_s integer NOT NULL DEFAULT 30,
  delay_max_s integer NOT NULL DEFAULT 50,
  batch_size integer NOT NULL DEFAULT 20,
  pause_between_batches_min integer NOT NULL DEFAULT 10,
  pause_between_batches_max integer NOT NULL DEFAULT 15,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_profiles TO authenticated;
GRANT ALL ON public.dispatch_profiles TO service_role;
ALTER TABLE public.dispatch_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read dispatch_profiles" ON public.dispatch_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage dispatch_profiles" ON public.dispatch_profiles FOR ALL TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE TABLE public.broadcast_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  template_name text NOT NULL,
  template_language text NOT NULL DEFAULT 'pt_BR',
  template_body text NOT NULL DEFAULT '',
  template_params jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile_id uuid REFERENCES public.dispatch_profiles(id) ON DELETE SET NULL,
  delay_min_s integer NOT NULL DEFAULT 30,
  delay_max_s integer NOT NULL DEFAULT 50,
  batch_size integer NOT NULL DEFAULT 20,
  pause_between_batches_min integer NOT NULL DEFAULT 10,
  pause_between_batches_max integer NOT NULL DEFAULT 15,
  status text NOT NULL DEFAULT 'draft',
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  next_batch_at timestamptz,
  error_message text,
  created_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_campaigns TO authenticated;
GRANT ALL ON public.broadcast_campaigns TO service_role;
ALTER TABLE public.broadcast_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can access broadcast_campaigns" ON public.broadcast_campaigns FOR ALL TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE TABLE public.broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.broadcast_campaigns(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  contact_name text,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_recipients TO authenticated;
GRANT ALL ON public.broadcast_recipients TO service_role;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can access broadcast_recipients" ON public.broadcast_recipients FOR ALL TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX idx_broadcast_recipients_campaign_status ON public.broadcast_recipients (campaign_id, status);
CREATE INDEX idx_broadcast_campaigns_status ON public.broadcast_campaigns (status);

CREATE TRIGGER set_broadcast_campaigns_updated_at
BEFORE UPDATE ON public.broadcast_campaigns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_dispatch_profiles_updated_at
BEFORE UPDATE ON public.dispatch_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
