-- Toque de WhatsApp da cadência ligado à mensagem enviada (27/10/2026).
-- Permite saber se o toque foi ENTREGUE — o D9 só sai se o D3 foi entregue
-- (playbook, Passo 4) — e fazer UMA nova tentativa quando a Meta barra a
-- mensagem pelo limite de marketing por usuário (erro 131049).
alter table public.cadence_state
  add column if not exists message_id uuid references public.messages(id) on delete set null,
  add column if not exists attempts smallint not null default 0,
  add column if not exists retried_at timestamptz;

create index if not exists cadence_state_message_id_idx on public.cadence_state (message_id);

-- Backfill dos toques de WhatsApp já enviados: liga cada step à mensagem do
-- template gravada na conversa de WhatsApp do contato no mesmo instante.
update public.cadence_state cs
set message_id = sub.mid, attempts = 1
from (
  select cs2.id,
    (select m.id
       from public.messages m
       join public.conversations c on c.id = m.conversation_id
      where c.contact_id = cs2.contact_id
        and c.channel = 'whatsapp'
        and m.from_type = 'nina'
        and m.created_at between cs2.sent_at - interval '5 minutes' and cs2.sent_at + interval '5 minutes'
      order by abs(extract(epoch from (m.created_at - cs2.sent_at)))
      limit 1) as mid
  from public.cadence_state cs2
  where cs2.channel = 'whatsapp' and cs2.status = 'sent' and cs2.message_id is null
) sub
where sub.id = cs.id and sub.mid is not null;
