-- Varreduras agendadas (pg_cron + pg_net) no Supabase próprio.
-- No Lovable Cloud esses jobs existiam fora do repositório; aqui ficam versionados.
-- URL e service role vêm do Vault (edge_project_url / edge_service_role_key),
-- semeados pelo ensureEdgeSecrets (initialize-system / nina-orchestrator) — nada
-- de chave hardcoded em migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_edge_function(_fn text, _body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'edge_project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'edge_service_role_key';
  if v_url is null or v_key is null then
    raise warning 'invoke_edge_function(%): segredos do Vault ausentes', _fn;
    return null;
  end if;
  return net.http_post(
    url := v_url || '/functions/v1/' || _fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := _body,
    timeout_milliseconds := 60000
  );
end;
$function$;

revoke all on function public.invoke_edge_function(text, jsonb) from public, anon, authenticated;
grant execute on function public.invoke_edge_function(text, jsonb) to service_role;

-- Só as edge functions (service role) podem gravar os segredos que os crons usam.
-- O grant herdado do Lovable deixava anon/authenticated sobrescrever o Vault.
revoke all on function public.ensure_edge_secrets(text, text) from public, anon, authenticated;
grant execute on function public.ensure_edge_secrets(text, text) to service_role;

-- Redes de segurança das filas (o caminho normal é encadeado pelos webhooks).
select cron.schedule('nina-message-grouper-sweep', '* * * * *', $$select public.invoke_edge_function('message-grouper')$$);
select cron.schedule('nina-orchestrator-sweep', '* * * * *', $$select public.invoke_edge_function('nina-orchestrator')$$);
select cron.schedule('nina-whatsapp-sender-sweep', '* * * * *', $$select public.invoke_edge_function('whatsapp-sender')$$);

-- Cadência da Lis (a função só age 9h-17h em dias úteis). Nasce PAUSADA: ligar com
--   select cron.alter_job((select jobid from cron.job where jobname = 'lis-cadence-worker'), active := true);
select cron.schedule('lis-cadence-worker', '*/5 * * * *', $$select public.invoke_edge_function('cadence-worker', '{"action":"run"}'::jsonb)$$);
select cron.alter_job((select jobid from cron.job where jobname = 'lis-cadence-worker'), active := false);
