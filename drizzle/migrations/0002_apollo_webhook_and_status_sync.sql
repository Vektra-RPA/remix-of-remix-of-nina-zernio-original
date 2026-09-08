ALTER TABLE public.apollo_search_settings
  ADD COLUMN IF NOT EXISTS reveal_phones boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS webhook_token text DEFAULT replace(gen_random_uuid()::text, '-', '');

CREATE OR REPLACE FUNCTION public.sync_apollo_lead_from_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'sent' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.apollo_leads
       SET status = CASE WHEN status IN ('new', 'queued', 'no_phone') THEN 'contacted' ELSE status END,
           contacted_at = COALESCE(contacted_at, now())
     WHERE contact_id = NEW.contact_id AND campaign_id = NEW.campaign_id;
  ELSIF NEW.status = 'failed' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.apollo_leads
       SET status = CASE WHEN status IN ('new', 'queued') THEN 'failed' ELSE status END
     WHERE contact_id = NEW.contact_id AND campaign_id = NEW.campaign_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apollo_lead_from_recipient
  AFTER UPDATE ON public.broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION public.sync_apollo_lead_from_recipient();

CREATE OR REPLACE FUNCTION public.sync_apollo_lead_on_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contact_id uuid;
BEGIN
  IF NEW.from_type <> 'user' THEN
    RETURN NEW;
  END IF;
  SELECT contact_id INTO v_contact_id FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.apollo_leads
     SET status = CASE WHEN status IN ('contacted', 'queued', 'new') THEN 'replied' ELSE status END,
         replied_at = COALESCE(replied_at, now())
   WHERE contact_id = v_contact_id AND status IN ('contacted', 'queued', 'new');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apollo_lead_on_reply
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.sync_apollo_lead_on_reply();
