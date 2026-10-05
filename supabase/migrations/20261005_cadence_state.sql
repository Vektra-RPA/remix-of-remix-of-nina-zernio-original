-- Épico C — Motor de cadência (porte do src/pipeline/cadencia.py da Lis Python).
-- Tabela de estado da cadência: um registro por (contato, step).
-- Aplicar com acesso ao banco (SQL editor do Supabase ou `supabase db push`).
-- As edge functions acessam via service role (ignora RLS); o frontend não lê/escreve direto.

create table if not exists public.cadence_state (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  step          integer not null,              -- 1..5
  tipo          text not null,                 -- abertura | followup1 | followup2 | followup3 | breakup
  channel       text not null default 'email', -- email | whatsapp
  scheduled_at  timestamptz not null,
  status        text not null default 'pending', -- pending | sending | sent | cancelled | skipped
  sent_at       timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Um contato nunca tem o mesmo step duplicado (enroll idempotente).
create unique index if not exists cadence_state_contact_step_uidx
  on public.cadence_state (contact_id, step);

-- Busca de steps devidos (status + horário) e varredura por contato.
create index if not exists cadence_state_due_idx
  on public.cadence_state (status, scheduled_at);
create index if not exists cadence_state_contact_idx
  on public.cadence_state (contact_id, step);

-- updated_at automático.
create or replace function public.touch_cadence_state_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_cadence_state_updated_at on public.cadence_state;
create trigger trg_cadence_state_updated_at
  before update on public.cadence_state
  for each row execute function public.touch_cadence_state_updated_at();

-- RLS ligado e sem policy permissiva: só a service role (edge functions) acessa.
-- Quando o painel (Épico H) precisar ler, adicionar uma policy de SELECT para
-- usuários do workspace.
alter table public.cadence_state enable row level security;
