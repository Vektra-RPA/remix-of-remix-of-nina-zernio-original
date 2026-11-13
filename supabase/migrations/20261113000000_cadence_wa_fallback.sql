-- E-mail de reforço quando o toque de WhatsApp da cadência não chega ao lead
-- (13/11/2026). Um por toque: fallback_status registra o que aconteceu ('sent' ou
-- 'skipped: motivo') e fallback_email_at a hora do envio, que conta na cota diária
-- de e-mail. Ver _shared/wa-fallback.ts e runWaFallbackEmails no cadence-worker.
alter table public.cadence_state
  add column if not exists fallback_status text,
  add column if not exists fallback_email_at timestamptz;

create index if not exists cadence_state_fallback_email_at_idx
  on public.cadence_state (fallback_email_at)
  where fallback_email_at is not null;

-- Toques de WhatsApp anteriores ao recurso (lote 1) não ganham e-mail retroativo.
update public.cadence_state
set fallback_status = 'skipped: anterior ao recurso'
where channel = 'whatsapp'
  and fallback_status is null
  and status in ('sent', 'skipped', 'cancelled');
