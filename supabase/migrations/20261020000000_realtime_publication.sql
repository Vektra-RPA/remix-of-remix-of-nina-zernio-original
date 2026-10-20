-- Publicação Realtime: tabelas que o frontend observa (Chat ao vivo, Kanban,
-- Agenda, Equipe e Disparos). O remix da Lovable não copia a publicação, então
-- ela é recriada aqui. Idempotente: ignora tabela já publicada.
do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'conversations', 'contacts', 'deals', 'appointments',
    'pipeline_stages', 'teams', 'team_functions', 'team_members',
    'broadcast_campaigns'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
