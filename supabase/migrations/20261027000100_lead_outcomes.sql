-- Classificação manual de cada lead do lote (playbook 7.1 e 7.3): a dona da
-- campanha marca o tipo de resposta e o motivo de perda no painel do Piloto.
-- Tabela própria (e não client_memory) para não disputar escrita com a Lis.
create table if not exists public.lead_outcomes (
  contact_id uuid primary key references public.contacts(id) on delete cascade,
  reply_type text check (reply_type in ('positiva', 'neutra', 'negativa', 'indicacao', 'descadastro')),
  loss_reason text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.lead_outcomes enable row level security;

drop policy if exists "lead_outcomes_select_authenticated" on public.lead_outcomes;
create policy "lead_outcomes_select_authenticated"
  on public.lead_outcomes for select to authenticated using (true);

drop policy if exists "lead_outcomes_write_admin" on public.lead_outcomes;
create policy "lead_outcomes_write_admin"
  on public.lead_outcomes for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
