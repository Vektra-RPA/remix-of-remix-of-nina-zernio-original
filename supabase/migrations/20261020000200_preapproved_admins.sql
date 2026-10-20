-- Time da Trajetória pré-autorizado por e-mail + fim da auto-promoção a admin do
-- workspace para qualquer conta nova.
--
-- 1) preapproved_admins: no login (bootstrap_current_user roda em todo SIGNED_IN),
--    quem está na lista E já confirmou o e-mail vira admin e entra no workspace.
-- 2) bootstrap_agent_workspace: antes, qualquer usuário autenticado que abrisse a
--    tela da agente entrava no workspace existente como admin com permissão de
--    publicar. Agora só entra quem já é admin (has_role); instalação vazia continua
--    criando o primeiro workspace normalmente.

create table if not exists public.preapproved_admins (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.preapproved_admins enable row level security;
revoke all on table public.preapproved_admins from anon, authenticated;
grant all on table public.preapproved_admins to service_role;

insert into public.preapproved_admins (email) values
  ('erickconche@trajetoriaconsultoria.com.br'),
  ('fabianosouza@trajetoriaconsultoria.com.br')
on conflict do nothing;

CREATE OR REPLACE FUNCTION public.bootstrap_current_user(_full_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid();
  _email text;
begin
  if _uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.profiles (user_id, full_name)
  values (_uid, nullif(_full_name, ''))
  on conflict (user_id) do nothing;

  if not exists (select 1 from public.user_roles where user_id = _uid) then
    if not exists (select 1 from public.user_roles where role = 'admin') then
      insert into public.user_roles (user_id, role) values (_uid, 'admin');
    else
      insert into public.user_roles (user_id, role) values (_uid, 'user');
    end if;
  end if;

  -- Pré-autorizados: só com e-mail confirmado (prova de posse da caixa).
  select lower(u.email) into _email
  from auth.users u
  where u.id = _uid and u.email_confirmed_at is not null;

  if _email is not null and exists (select 1 from public.preapproved_admins p where lower(p.email) = _email) then
    insert into public.user_roles (user_id, role) values (_uid, 'admin')
    on conflict (user_id, role) do nothing;

    insert into public.workspace_members (workspace_id, user_id, role, can_publish_agent, status)
    select w.id, _uid, 'admin', true, 'active'
    from public.workspaces w
    where w.status = 'active'
    on conflict (workspace_id, user_id) do update
      set role = 'admin', can_publish_agent = true, status = 'active';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.bootstrap_agent_workspace(_workspace_name text, _config jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_workspace uuid;
  v_agent uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  SELECT wm.workspace_id INTO v_workspace
  FROM public.workspace_members wm
  JOIN public.workspaces w ON w.id = wm.workspace_id AND w.status = 'active'
  WHERE wm.user_id = v_user AND wm.status = 'active'
  ORDER BY wm.created_at
  LIMIT 1;

  IF v_workspace IS NULL THEN
    -- Arquitetura single-tenant: entra no workspace existente em vez de criar um paralelo.
    SELECT id INTO v_workspace FROM public.workspaces WHERE status = 'active' ORDER BY created_at LIMIT 1;

    -- Workspace já existe: só admin do sistema entra (e entra como admin).
    -- Conta comum recém-criada não ganha mais acesso de edição/publicação da agente.
    IF v_workspace IS NOT NULL AND NOT public.has_role(v_user, 'admin'::app_role) THEN
      RAISE EXCEPTION 'Sem acesso ao workspace. Peça a um administrador para liberar seu acesso.'
        USING ERRCODE = '42501';
    END IF;

    IF v_workspace IS NULL THEN
      INSERT INTO public.workspaces (name, slug, created_by)
      VALUES (
        COALESCE(NULLIF(btrim(_workspace_name), ''), 'Workspace'),
        'ws-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
        v_user
      )
      RETURNING id INTO v_workspace;
    END IF;

    INSERT INTO public.workspace_members (workspace_id, user_id, role, can_publish_agent, status)
    VALUES (v_workspace, v_user, 'admin', true, 'active')
    ON CONFLICT (workspace_id, user_id) DO UPDATE
      SET status = 'active', role = 'admin', can_publish_agent = true;
  END IF;

  SELECT id INTO v_agent FROM public.agents WHERE workspace_id = v_workspace LIMIT 1;

  IF v_agent IS NULL THEN
    INSERT INTO public.agents (workspace_id, created_by, updated_by)
    VALUES (v_workspace, v_user, v_user)
    RETURNING id INTO v_agent;
  END IF;

  INSERT INTO public.agent_drafts (workspace_id, agent_id, config, created_by, updated_by)
  VALUES (v_workspace, v_agent, _config, v_user, v_user)
  ON CONFLICT (agent_id) DO NOTHING;
END;
$function$;
