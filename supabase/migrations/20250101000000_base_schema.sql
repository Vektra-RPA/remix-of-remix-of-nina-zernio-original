-- Schema extraído do projeto Lovable remix (Nina) em 2026-10-20T15:17:04.582Z
set check_function_bodies = off;

create extension if not exists pg_cron with schema pg_catalog;

create extension if not exists pg_stat_statements with schema extensions;

create extension if not exists pg_trgm with schema public;

create extension if not exists pg_net with schema extensions;

create extension if not exists "uuid-ossp" with schema extensions;

create extension if not exists pgcrypto with schema extensions;

create extension if not exists supabase_vault with schema vault;

create extension if not exists btree_gist with schema public;

do $t$ begin create type public.member_status as enum ('active', 'invited', 'disabled'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.conversation_status as enum ('nina', 'human', 'paused'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.app_role as enum ('admin', 'user'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.member_role as enum ('admin', 'manager', 'agent'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.message_from as enum ('user', 'nina', 'human'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.message_status as enum ('sent', 'delivered', 'read', 'failed', 'processing'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.appointment_type as enum ('demo', 'meeting', 'support', 'followup'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.message_type as enum ('text', 'audio', 'image', 'document', 'video'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.queue_status as enum ('pending', 'processing', 'completed', 'failed'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.team_assignment as enum ('mateus', 'igor', 'fe', 'vendas', 'suporte'); exception when duplicate_object then null; end $t$;

do $t$ begin create type public.workspace_member_role as enum ('admin', 'editor', 'observer'); exception when duplicate_object then null; end $t$;

create table if not exists public.contacts (id uuid not null, phone_number text, whatsapp_id text, name text, call_name text, email text, profile_picture_url text, is_business boolean, is_blocked boolean, blocked_at timestamp with time zone, blocked_reason text, tags text[], notes text, client_memory jsonb, first_contact_date timestamp with time zone not null, last_activity timestamp with time zone not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, user_id uuid, instagram_user_id text, instagram_username text, avatar_url text);

create table if not exists public.channel_connections (id uuid not null, platform text not null, provider text not null, zernio_account_id text not null, zernio_profile_id text, username text, display_name text, status text not null, connected_at timestamp with time zone, disconnected_at timestamp with time zone, metadata jsonb, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.unanswered_questions (id uuid not null, conversation_id uuid, contact_id uuid, question text not null, context text, status text not null, resolved_fact_id uuid, created_at timestamp with time zone not null, workspace_id uuid not null, kind text not null, metadata jsonb not null);

create table if not exists public.agent_action_runs (id uuid not null, workspace_id uuid not null, agent_version_id uuid, conversation_id uuid, contact_id uuid, source_message_id uuid, action_key text not null, mode text not null, idempotency_key text not null, status text not null, input jsonb not null, output jsonb not null, error_code text, started_at timestamp with time zone not null, finished_at timestamp with time zone, created_at timestamp with time zone not null);

create table if not exists public.agent_runtime_events (id uuid not null, workspace_id uuid not null, agent_id uuid not null, agent_version_id uuid not null, conversation_id uuid, contact_id uuid, source_message_id uuid, event_kind text not null, compiler_version text not null, model_provider text, model_name text, route text, sources jsonb not null, tools jsonb not null, guards jsonb not null, latency_ms integer, estimated_cost numeric, handoff boolean not null, error_code text, metadata jsonb not null, created_at timestamp with time zone not null);

create table if not exists public.knowledge_documents (id uuid not null, title text not null, content text not null, doc_type text not null, is_active boolean not null, chunk_count integer not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, workspace_id uuid not null, source_url text, status text not null, ingestion_report jsonb not null, error_message text, fingerprint text);

create table if not exists public.agent_audit_log (id uuid not null, workspace_id uuid not null, agent_id uuid, actor_user_id uuid, action text not null, entity_type text not null, entity_id uuid, metadata jsonb not null, created_at timestamp with time zone not null);

create table if not exists public.calendar_oauth_states (id uuid not null, state_hash text not null, user_id uuid not null, expires_at timestamp with time zone not null, created_at timestamp with time zone not null);

create table if not exists public.agents (id uuid not null, workspace_id uuid not null, name text not null, status text not null, published_version_id uuid, created_by uuid, updated_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.conversation_states (id uuid not null, conversation_id uuid not null, current_state text not null, last_action text, last_action_at timestamp with time zone, scheduling_context jsonb, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.nina_processing_queue (id uuid not null, message_id uuid not null, conversation_id uuid not null, contact_id uuid not null, context_data jsonb, status queue_status not null, priority integer not null, retry_count integer not null, error_message text, scheduled_for timestamp with time zone, processed_at timestamp with time zone, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.message_processing_queue (id uuid not null, whatsapp_message_id text not null, phone_number_id text not null, raw_data jsonb not null, status queue_status not null, priority integer not null, retry_count integer not null, error_message text, scheduled_for timestamp with time zone, processed_at timestamp with time zone, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.send_queue (id uuid not null, conversation_id uuid not null, contact_id uuid not null, message_type text not null, from_type text not null, content text, media_url text, metadata jsonb, status queue_status not null, priority integer not null, retry_count integer not null, error_message text, scheduled_at timestamp with time zone, sent_at timestamp with time zone, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, message_id uuid);

create table if not exists public.agent_versions (id uuid not null, workspace_id uuid not null, agent_id uuid not null, version_number integer not null, config jsonb not null, compiled_prompt text not null, checksum text not null, label text, source text not null, evaluation_run_id uuid, accepted_warnings jsonb not null, restored_from_version_id uuid, created_by uuid, published_at timestamp with time zone not null, created_at timestamp with time zone not null, compiler_version text not null);

create table if not exists public.user_roles (id uuid not null, user_id uuid not null, role app_role not null, created_at timestamp with time zone not null);

create table if not exists public.team_members (id uuid not null, name text not null, email text not null, role member_role not null, status member_status not null, avatar text, team_id uuid, function_id uuid, weight integer, last_active timestamp with time zone, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, user_id uuid);

create table if not exists public.knowledge_chunks (id uuid not null, document_id uuid not null, chunk_index integer not null, content text not null, fts tsvector generated always as (to_tsvector('portuguese'::regconfig, content)) stored, created_at timestamp with time zone not null, workspace_id uuid not null);

create table if not exists public.agent_operation_rate_limits (workspace_id uuid not null, subject_key text not null, operation text not null, window_key bigint not null, request_count integer not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.calendar_integrations (id uuid not null, provider text not null, owner_user_id uuid not null, account_email text, calendar_id text not null, access_token text, refresh_token text, token_expires_at timestamp with time zone, scopes text[] not null, status text not null, sync_enabled boolean not null, create_meet boolean not null, time_zone text not null, last_synced_at timestamp with time zone, last_error text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, grant_id text, grant_provider text);

create table if not exists public.agent_drafts (id uuid not null, workspace_id uuid not null, agent_id uuid not null, config jsonb not null, revision integer not null, base_version_id uuid, created_by uuid, updated_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.workspaces (id uuid not null, name text not null, slug text not null, status text not null, created_by uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.agent_suggestions (id uuid not null, workspace_id uuid not null, agent_id uuid not null, suggestion_type text not null, title text not null, rationale text not null, proposed_change jsonb not null, evidence jsonb not null, fingerprint text not null, source_conversation_id uuid, status text not null, reviewed_by uuid, reviewed_at timestamp with time zone, applied_entity_type text, applied_entity_id uuid, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.deal_activities (id uuid not null, deal_id uuid not null, type text not null, title text not null, description text, scheduled_at timestamp with time zone, completed_at timestamp with time zone, is_completed boolean, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone);

create table if not exists public.teams (id uuid not null, name text not null, description text, color text, is_active boolean, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, user_id uuid);

create table if not exists public.zernio_webhook_events (id uuid not null, event_id text not null, event_type text not null, payload jsonb not null, processed boolean not null, error text, created_at timestamp with time zone not null);

create table if not exists public.workspace_members (id uuid not null, workspace_id uuid not null, user_id uuid not null, role workspace_member_role not null, can_publish_agent boolean not null, status text not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.tag_definitions (id uuid not null, key text not null, label text not null, color text not null, category text not null, is_active boolean not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, user_id uuid);

create table if not exists public.prompt_versions (id uuid not null, content text not null, blocks jsonb not null, label text, source text not null, created_by uuid, eval_run_id uuid, created_at timestamp with time zone not null);

create table if not exists public.team_functions (id uuid not null, name text not null, description text, is_active boolean, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, user_id uuid);

create table if not exists public.nina_settings (id uuid not null, is_active boolean not null, system_prompt_override text, test_system_prompt text, elevenlabs_api_key text, elevenlabs_voice_id text not null, elevenlabs_model text, elevenlabs_stability numeric not null, elevenlabs_similarity_boost numeric not null, elevenlabs_style numeric not null, elevenlabs_speaker_boost boolean not null, elevenlabs_speed numeric, whatsapp_access_token text, whatsapp_phone_number_id text, whatsapp_verify_token text, auto_response_enabled boolean not null, adaptive_response_enabled boolean not null, message_breaking_enabled boolean not null, response_delay_min integer not null, response_delay_max integer not null, timezone text not null, business_hours_start time without time zone not null, business_hours_end time without time zone not null, business_days integer[] not null, async_booking_enabled boolean, route_all_to_receiver_enabled boolean not null, test_phone_numbers jsonb, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, company_name text, sdr_name text, ai_model_mode text, audio_response_enabled boolean, ai_scheduling_enabled boolean, whatsapp_business_account_id text, user_id uuid, zernio_api_key text, zernio_profile_id text, zernio_webhook_id text, zernio_webhook_secret text, onboarding_completed_at timestamp with time zone, onboarding_dismissed_at timestamp with time zone, ai_provider text not null, ai_model text, anthropic_api_key text, openai_api_key text, whatsapp_webhook_key text, nylas_client_id text, nylas_api_key text, nylas_api_uri text, demo_mode_enabled boolean not null);

create table if not exists public.messages (id uuid not null, conversation_id uuid not null, reply_to_id uuid, whatsapp_message_id text, type message_type not null, from_type message_from not null, content text, media_url text, media_type text, status message_status not null, processed_by_nina boolean, nina_response_time integer, metadata jsonb, sent_at timestamp with time zone not null, delivered_at timestamp with time zone, read_at timestamp with time zone, created_at timestamp with time zone not null, zernio_message_id text);

create table if not exists public.conversations (id uuid not null, contact_id uuid not null, status conversation_status not null, is_active boolean not null, assigned_team team_assignment, assigned_user_id uuid, tags text[], nina_context jsonb, metadata jsonb, started_at timestamp with time zone not null, last_message_at timestamp with time zone not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, user_id uuid, channel text not null, zernio_conversation_id text, zernio_account_id text);

create table if not exists public.pipeline_stages (id uuid not null, title text not null, color text not null, "position" integer not null, is_system boolean, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone, ai_trigger_criteria text, is_ai_managed boolean, user_id uuid);

create table if not exists public.golden_cases (id uuid not null, query text not null, expected_behavior text not null, expected_content text, category text not null, origin text not null, notes text, is_active boolean not null, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, workspace_id uuid not null, title text not null, scenario_key text, severity text not null, messages jsonb not null, source_rule text, accepted_at timestamp with time zone, accepted_by uuid);

create table if not exists public.eval_runs (id uuid not null, status text not null, total_cases integer not null, passed integer not null, failed integer not null, errored integer not null, prompt_source text not null, test_prompt text, model_mode text, started_by uuid, created_at timestamp with time zone not null, finished_at timestamp with time zone, workspace_id uuid not null, agent_id uuid not null, draft_id uuid, draft_revision integer, compiler_version text, config_snapshot jsonb, critical_failures integer not null, warnings integer not null, unstable integer not null, technical_failures integer not null, gate_status text not null, accepted_warnings integer not null);

create table if not exists public.knowledge_facts (id uuid not null, category text not null, question text, fact text not null, source text, is_active boolean not null, always_include boolean not null, fts tsvector generated always as (to_tsvector('portuguese'::regconfig, ((COALESCE(question, ''::text) || ' '::text) || fact))) stored, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, workspace_id uuid not null, title text not null, status text not null, confirmed_by uuid, confirmed_at timestamp with time zone, valid_from timestamp with time zone not null, expires_at timestamp with time zone);

create table if not exists public.profiles (id uuid not null, user_id uuid not null, full_name text, avatar_url text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null);

create table if not exists public.message_grouping_queue (id uuid not null, whatsapp_message_id text not null, phone_number_id text not null, message_data jsonb not null, contacts_data jsonb, processed boolean not null, created_at timestamp with time zone not null, process_after timestamp with time zone, message_id uuid);

create table if not exists public.deals (id uuid not null, contact_id uuid, title text not null, company text, value numeric, stage text, priority text, tags text[], due_date date, owner_id uuid, notes text, lost_reason text, won_at timestamp with time zone, lost_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, stage_id uuid not null, user_id uuid);

create table if not exists public.appointments (id uuid not null, title text not null, description text, date date not null, "time" time without time zone not null, duration integer not null, type appointment_type not null, attendees text[], contact_id uuid, meeting_url text, status text, created_at timestamp with time zone not null, updated_at timestamp with time zone not null, metadata jsonb, user_id uuid, calendar_provider text, external_calendar_event_id text, calendar_sync_status text not null, calendar_synced_at timestamp with time zone, calendar_sync_error text, workspace_id uuid not null);

create table if not exists public.eval_results (id uuid not null, run_id uuid not null, case_id uuid, query text not null, expected_behavior text not null, expected_content text, category text not null, reply text, grounding jsonb, verdict text not null, judge_reason text, latency_ms integer, created_at timestamp with time zone not null, workspace_id uuid not null, severity text not null, result_status text not null, checker_details jsonb not null, attempts integer not null, reviewer_verdict text, reviewed_by uuid, reviewed_at timestamp with time zone);

alter table public.channel_connections add constraint channel_connections_pkey PRIMARY KEY (id);

alter table public.contacts add constraint contacts_phone_number_unique UNIQUE (phone_number);

alter table public.contacts add constraint contacts_pkey PRIMARY KEY (id);

alter table public.messages add constraint messages_pkey PRIMARY KEY (id);

alter table public.deal_activities add constraint deal_activities_pkey PRIMARY KEY (id);

alter table public.golden_cases add constraint golden_cases_pkey PRIMARY KEY (id);

alter table public.deals add constraint deals_pkey PRIMARY KEY (id);

alter table public.eval_runs add constraint eval_runs_pkey PRIMARY KEY (id);

alter table public.knowledge_facts add constraint knowledge_facts_pkey PRIMARY KEY (id);

alter table public.knowledge_chunks add constraint knowledge_chunks_pkey PRIMARY KEY (id);

alter table public.message_grouping_queue add constraint message_grouping_queue_pkey PRIMARY KEY (id);

alter table public.nina_settings add constraint nina_settings_pkey PRIMARY KEY (id);

alter table public.nina_settings add constraint nina_settings_user_id_unique UNIQUE (user_id);

alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);

alter table public.unanswered_questions add constraint unanswered_questions_pkey PRIMARY KEY (id);

alter table public.workspace_members add constraint workspace_members_pkey PRIMARY KEY (id);

alter table public.user_roles add constraint user_roles_pkey PRIMARY KEY (id);

alter table public.user_roles add constraint user_roles_user_id_role_key UNIQUE (user_id, role);

alter table public.workspaces add constraint workspaces_pkey PRIMARY KEY (id);

alter table public.workspaces add constraint workspaces_slug_key UNIQUE (slug);

alter table public.zernio_webhook_events add constraint zernio_webhook_events_event_id_unique UNIQUE (event_id);

alter table public.workspace_members add constraint workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);

alter table public.zernio_webhook_events add constraint zernio_webhook_events_pkey PRIMARY KEY (id);

alter table public.pipeline_stages add constraint pipeline_stages_pkey PRIMARY KEY (id);

alter table public.prompt_versions add constraint prompt_versions_pkey PRIMARY KEY (id);

alter table public.team_functions add constraint team_functions_pkey PRIMARY KEY (id);

alter table public.team_functions add constraint team_functions_user_name_unique UNIQUE (user_id, name);

alter table public.message_processing_queue add constraint message_processing_queue_pkey PRIMARY KEY (id);

alter table public.nina_processing_queue add constraint nina_processing_queue_pkey PRIMARY KEY (id);

alter table public.conversation_states add constraint conversation_states_conversation_id_key UNIQUE (conversation_id);

alter table public.send_queue add constraint send_queue_pkey PRIMARY KEY (id);

alter table public.conversation_states add constraint conversation_states_pkey PRIMARY KEY (id);

alter table public.agent_versions add constraint agent_versions_agent_id_version_number_key UNIQUE (agent_id, version_number);

alter table public.agent_drafts add constraint agent_drafts_agent_id_key UNIQUE (agent_id);

alter table public.agent_versions add constraint agent_versions_pkey PRIMARY KEY (id);

alter table public.agent_drafts add constraint agent_drafts_pkey PRIMARY KEY (id);

alter table public.agent_suggestions add constraint agent_suggestions_pkey PRIMARY KEY (id);

alter table public.eval_results add constraint eval_results_pkey PRIMARY KEY (id);

alter table public.agent_suggestions add constraint agent_suggestions_workspace_id_fingerprint_key UNIQUE (workspace_id, fingerprint);

alter table public.eval_results add constraint eval_results_run_id_case_id_key UNIQUE (run_id, case_id);

alter table public.knowledge_documents add constraint knowledge_documents_pkey PRIMARY KEY (id);

alter table public.agent_audit_log add constraint agent_audit_log_pkey PRIMARY KEY (id);

alter table public.agent_operation_rate_limits add constraint agent_operation_rate_limits_pkey PRIMARY KEY (workspace_id, subject_key, operation, window_key);

alter table public.agent_action_runs add constraint agent_action_runs_pkey PRIMARY KEY (id);

alter table public.agent_action_runs add constraint agent_action_runs_workspace_id_idempotency_key_key UNIQUE (workspace_id, idempotency_key);

alter table public.agent_runtime_events add constraint agent_runtime_events_pkey PRIMARY KEY (id);

alter table public.agents add constraint agents_pkey PRIMARY KEY (id);

alter table public.agents add constraint agents_workspace_id_key UNIQUE (workspace_id);

alter table public.appointments add constraint appointments_pkey PRIMARY KEY (id);

alter table public.conversations add constraint conversations_pkey PRIMARY KEY (id);

alter table public.appointments add constraint appointments_workspace_no_overlap EXCLUDE USING gist (workspace_id WITH =, tsrange((date + "time"), ((date + "time") + make_interval(mins => duration)), '[)'::text) WITH &&) WHERE ((status = 'scheduled'::text));

alter table public.calendar_integrations add constraint calendar_integrations_pkey PRIMARY KEY (id);

alter table public.calendar_integrations add constraint calendar_integrations_provider_key UNIQUE (provider);

alter table public.calendar_oauth_states add constraint calendar_oauth_states_pkey PRIMARY KEY (id);

alter table public.calendar_oauth_states add constraint calendar_oauth_states_state_hash_key UNIQUE (state_hash);

alter table public.channel_connections add constraint channel_connections_provider_account_unique UNIQUE (provider, zernio_account_id);

alter table public.profiles add constraint profiles_user_id_key UNIQUE (user_id);

alter table public.tag_definitions add constraint tag_definitions_pkey PRIMARY KEY (id);

alter table public.tag_definitions add constraint tag_definitions_user_key_unique UNIQUE (user_id, key);

alter table public.team_members add constraint team_members_email_key UNIQUE (email);

alter table public.team_members add constraint team_members_pkey PRIMARY KEY (id);

alter table public.teams add constraint teams_pkey PRIMARY KEY (id);

alter table public.teams add constraint teams_user_name_unique UNIQUE (user_id, name);

CREATE OR REPLACE FUNCTION public.publish_agent_draft(_agent_id uuid, _expected_revision integer, _evaluation_run_id uuid DEFAULT NULL::uuid, _label text DEFAULT NULL::text, _accepted_warnings jsonb DEFAULT '[]'::jsonb)
 RETURNS agent_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    target_agent public.agents;
    current_draft public.agent_drafts;
    current_version public.agent_versions;
    new_version public.agent_versions;
    next_version_number INTEGER;
    prompt_artifact TEXT;
BEGIN
    SELECT a.*
      INTO target_agent
      FROM public.agents a
     WHERE a.id = _agent_id
     FOR UPDATE;

    IF target_agent.id IS NULL OR NOT public.can_publish_agent(target_agent.workspace_id) THEN
        RAISE EXCEPTION 'Sem permissão para publicar este agente'
            USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(_accepted_warnings) <> 'array' THEN
        RAISE EXCEPTION 'Alertas aceitos devem ser uma lista'
            USING ERRCODE = '22023';
    END IF;

    SELECT d.*
      INTO current_draft
      FROM public.agent_drafts d
     WHERE d.agent_id = _agent_id
     FOR UPDATE;

    IF current_draft.id IS NULL OR current_draft.revision <> _expected_revision THEN
        RAISE EXCEPTION 'O rascunho mudou antes da publicação'
            USING ERRCODE = '40001';
    END IF;

    IF target_agent.published_version_id IS NOT NULL THEN
        SELECT v.* INTO current_version
        FROM public.agent_versions v
        WHERE v.id = target_agent.published_version_id;
    END IF;

    -- Compatibilidade temporária da Fase 1. Na Fase 2 este valor será sempre
    -- produzido pelo compilador determinístico a partir do config estruturado.
    prompt_artifact := COALESCE(
        NULLIF(current_draft.config #>> '{migration,legacyPrompt}', ''),
        current_version.compiled_prompt
    );

    IF prompt_artifact IS NULL THEN
        RAISE EXCEPTION 'O compilador de prompt ainda não gerou um artefato para este rascunho'
            USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(MAX(v.version_number), 0) + 1
      INTO next_version_number
      FROM public.agent_versions v
     WHERE v.agent_id = _agent_id;

    INSERT INTO public.agent_versions (
        workspace_id,
        agent_id,
        version_number,
        config,
        compiled_prompt,
        checksum,
        label,
        source,
        evaluation_run_id,
        accepted_warnings,
        restored_from_version_id,
        created_by
    ) VALUES (
        target_agent.workspace_id,
        _agent_id,
        next_version_number,
        current_draft.config,
        prompt_artifact,
        md5(current_draft.config::text || E'\n' || prompt_artifact),
        NULLIF(trim(_label), ''),
        CASE
            WHEN current_draft.base_version_id IS DISTINCT FROM target_agent.published_version_id
                THEN 'restoration'
            ELSE 'manual'
        END,
        _evaluation_run_id,
        _accepted_warnings,
        CASE
            WHEN current_draft.base_version_id IS DISTINCT FROM target_agent.published_version_id
                THEN current_draft.base_version_id
            ELSE NULL
        END,
        auth.uid()
    ) RETURNING * INTO new_version;

    UPDATE public.agents
       SET published_version_id = new_version.id,
           status = 'active',
           name = COALESCE(
               NULLIF(trim(current_draft.config #>> '{identity,agentName}'), ''),
               name
           ),
           updated_by = auth.uid(),
           updated_at = now()
     WHERE id = _agent_id;

    UPDATE public.agent_drafts
       SET base_version_id = new_version.id,
           updated_by = auth.uid(),
           updated_at = now()
     WHERE id = current_draft.id;

    INSERT INTO public.agent_audit_log (
        workspace_id, agent_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
        target_agent.workspace_id,
        _agent_id,
        auth.uid(),
        'agent.published',
        'agent_version',
        new_version.id,
        jsonb_build_object(
            'versionNumber', new_version.version_number,
            'revision', current_draft.revision,
            'evaluationRunId', _evaluation_run_id,
            'acceptedWarnings', _accepted_warnings,
            'evaluationGate', 'pending_phase_6'
        )
    );

    RETURN new_version;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_processed_queues()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    DELETE FROM public.message_processing_queue 
    WHERE status = 'completed' AND processed_at < now() - interval '24 hours';
    
    DELETE FROM public.nina_processing_queue 
    WHERE status = 'completed' AND processed_at < now() - interval '24 hours';
    
    DELETE FROM public.send_queue 
    WHERE status = 'completed' AND sent_at < now() - interval '24 hours';
    
    DELETE FROM public.message_processing_queue 
    WHERE status = 'failed' AND updated_at < now() - interval '7 days';
    
    DELETE FROM public.nina_processing_queue 
    WHERE status = 'failed' AND updated_at < now() - interval '7 days';
    
    DELETE FROM public.send_queue 
    WHERE status = 'failed' AND updated_at < now() - interval '7 days';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_agent_version_to_draft(_agent_id uuid, _version_id uuid, _expected_revision integer)
 RETURNS agent_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    target_workspace_id UUID;
    source_version public.agent_versions;
    current_draft public.agent_drafts;
    restored_draft public.agent_drafts;
BEGIN
    SELECT a.workspace_id
      INTO target_workspace_id
      FROM public.agents a
     WHERE a.id = _agent_id;

    IF target_workspace_id IS NULL OR NOT public.can_edit_agent(target_workspace_id) THEN
        RAISE EXCEPTION 'Sem permissão para restaurar este agente'
            USING ERRCODE = '42501';
    END IF;

    SELECT v.*
      INTO source_version
      FROM public.agent_versions v
     WHERE v.id = _version_id
       AND v.agent_id = _agent_id;

    IF source_version.id IS NULL THEN
        RAISE EXCEPTION 'Versão não encontrada para este agente'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT d.*
      INTO current_draft
      FROM public.agent_drafts d
     WHERE d.agent_id = _agent_id
     FOR UPDATE;

    IF current_draft.id IS NULL OR current_draft.revision <> _expected_revision THEN
        RAISE EXCEPTION 'O rascunho mudou antes da restauração'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.agent_drafts
       SET config = source_version.config,
           base_version_id = source_version.id,
           revision = revision + 1,
           updated_by = auth.uid(),
           updated_at = now()
     WHERE id = current_draft.id
     RETURNING * INTO restored_draft;

    INSERT INTO public.agent_audit_log (
        workspace_id, agent_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
        target_workspace_id,
        _agent_id,
        auth.uid(),
        'agent.version_restored_to_draft',
        'agent_version',
        source_version.id,
        jsonb_build_object(
            'restoredFromVersion', source_version.version_number,
            'draftRevision', restored_draft.revision
        )
    );

    RETURN restored_draft;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_agent_rate_limit(_workspace_id uuid, _subject_key text, _operation text, _max_requests integer, _window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    current_window BIGINT;
    consumed INTEGER;
BEGIN
    IF _workspace_id IS NULL
       OR coalesce(char_length(trim(_subject_key)), 0) = 0
       OR coalesce(char_length(trim(_operation)), 0) = 0
       OR _max_requests < 1 OR _max_requests > 10000
       OR _window_seconds < 1 OR _window_seconds > 86400 THEN
        RAISE EXCEPTION 'Parâmetros inválidos para rate limit' USING ERRCODE = '22023';
    END IF;

    current_window := floor(extract(epoch FROM clock_timestamp()) / _window_seconds)::BIGINT;

    INSERT INTO public.agent_operation_rate_limits (
        workspace_id, subject_key, operation, window_key, request_count
    ) VALUES (
        _workspace_id, left(_subject_key, 200), left(_operation, 100), current_window, 1
    )
    ON CONFLICT (workspace_id, subject_key, operation, window_key)
    DO UPDATE SET
        request_count = public.agent_operation_rate_limits.request_count + 1,
        updated_at = now()
    WHERE public.agent_operation_rate_limits.request_count < _max_requests
    RETURNING request_count INTO consumed;

    DELETE FROM public.agent_operation_rate_limits
     WHERE workspace_id = _workspace_id
       AND operation = left(_operation, 100)
       AND updated_at < now() - interval '2 days';

    RETURN consumed IS NOT NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_compiled_agent_draft(_agent_id uuid, _expected_revision integer, _compiled_prompt text, _compiler_version text, _actor_user_id uuid, _evaluation_run_id uuid DEFAULT NULL::uuid, _label text DEFAULT NULL::text, _accepted_warnings jsonb DEFAULT '[]'::jsonb)
 RETURNS agent_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    target_agent public.agents;
    current_draft public.agent_drafts;
    new_version public.agent_versions;
    next_version_number INTEGER;
BEGIN
    SELECT a.*
      INTO target_agent
      FROM public.agents a
     WHERE a.id = _agent_id
     FOR UPDATE;

    IF target_agent.id IS NULL
       OR NOT public.can_publish_agent(target_agent.workspace_id, _actor_user_id) THEN
        RAISE EXCEPTION 'Sem permissão para publicar este agente'
            USING ERRCODE = '42501';
    END IF;

    IF NULLIF(trim(_compiled_prompt), '') IS NULL
       OR NULLIF(trim(_compiler_version), '') IS NULL THEN
        RAISE EXCEPTION 'Artefato compilado e versão do compilador são obrigatórios'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(_accepted_warnings) <> 'array' THEN
        RAISE EXCEPTION 'Alertas aceitos devem ser uma lista'
            USING ERRCODE = '22023';
    END IF;

    SELECT d.*
      INTO current_draft
      FROM public.agent_drafts d
     WHERE d.agent_id = _agent_id
     FOR UPDATE;

    IF current_draft.id IS NULL OR current_draft.revision <> _expected_revision THEN
        RAISE EXCEPTION 'O rascunho mudou antes da publicação'
            USING ERRCODE = '40001';
    END IF;

    SELECT COALESCE(MAX(v.version_number), 0) + 1
      INTO next_version_number
      FROM public.agent_versions v
     WHERE v.agent_id = _agent_id;

    INSERT INTO public.agent_versions (
        workspace_id,
        agent_id,
        version_number,
        config,
        compiled_prompt,
        compiler_version,
        checksum,
        label,
        source,
        evaluation_run_id,
        accepted_warnings,
        restored_from_version_id,
        created_by
    ) VALUES (
        target_agent.workspace_id,
        _agent_id,
        next_version_number,
        current_draft.config,
        _compiled_prompt,
        _compiler_version,
        md5(
            current_draft.config::text
            || E'\n' || _compiler_version
            || E'\n' || _compiled_prompt
        ),
        NULLIF(trim(_label), ''),
        CASE
            WHEN current_draft.base_version_id IS DISTINCT FROM target_agent.published_version_id
                THEN 'restoration'
            ELSE 'manual'
        END,
        _evaluation_run_id,
        _accepted_warnings,
        CASE
            WHEN current_draft.base_version_id IS DISTINCT FROM target_agent.published_version_id
                THEN current_draft.base_version_id
            ELSE NULL
        END,
        _actor_user_id
    ) RETURNING * INTO new_version;

    UPDATE public.agents
       SET published_version_id = new_version.id,
           status = 'active',
           name = COALESCE(
               NULLIF(trim(current_draft.config #>> '{identity,agentName}'), ''),
               name
           ),
           updated_by = _actor_user_id,
           updated_at = now()
     WHERE id = _agent_id;

    UPDATE public.agent_drafts
       SET base_version_id = new_version.id,
           updated_by = _actor_user_id,
           updated_at = now()
     WHERE id = current_draft.id;

    INSERT INTO public.agent_audit_log (
        workspace_id, agent_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
        target_agent.workspace_id,
        _agent_id,
        _actor_user_id,
        'agent.published',
        'agent_version',
        new_version.id,
        jsonb_build_object(
            'versionNumber', new_version.version_number,
            'revision', current_draft.revision,
            'compilerVersion', _compiler_version,
            'checksum', new_version.checksum,
            'evaluationRunId', _evaluation_run_id,
            'acceptedWarnings', _accepted_warnings,
            'evaluationGate', 'pending_phase_6'
        )
    );

    RETURN new_version;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_or_create_conversation_state(p_conversation_id uuid)
 RETURNS conversation_states
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    state_record public.conversation_states;
BEGIN
    SELECT * INTO state_record
    FROM public.conversation_states
    WHERE conversation_id = p_conversation_id;
    
    IF NOT FOUND THEN
        INSERT INTO public.conversation_states (conversation_id, current_state)
        VALUES (p_conversation_id, 'idle')
        RETURNING * INTO state_record;
    END IF;
    
    RETURN state_record;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_agent_product_event(_agent_id uuid, _event text, _step text DEFAULT NULL::text, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    target_agent public.agents;
    allowed_events CONSTANT TEXT[] := ARRAY[
        'setup_started',
        'setup_step_viewed',
        'setup_proposal_generated',
        'setup_applied',
        'setup_abandoned'
    ];
BEGIN
    SELECT * INTO target_agent FROM public.agents WHERE id = _agent_id;
    IF target_agent.id IS NULL OR NOT public.can_edit_agent(target_agent.workspace_id) THEN
        RAISE EXCEPTION 'Agente não encontrada ou sem permissão' USING ERRCODE = '42501';
    END IF;
    IF NOT (_event = ANY(allowed_events)) THEN
        RAISE EXCEPTION 'Evento de produto inválido';
    END IF;
    IF _step IS NOT NULL AND (length(_step) = 0 OR length(_step) > 80) THEN
        RAISE EXCEPTION 'Etapa inválida';
    END IF;
    IF jsonb_typeof(COALESCE(_metadata, '{}'::jsonb)) <> 'object'
       OR octet_length(COALESCE(_metadata, '{}'::jsonb)::text) > 8192 THEN
        RAISE EXCEPTION 'Metadados inválidos ou acima do limite';
    END IF;

    INSERT INTO public.agent_audit_log (
        workspace_id, agent_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
        target_agent.workspace_id,
        target_agent.id,
        auth.uid(),
        'agent.product.' || _event,
        'agent',
        target_agent.id,
        COALESCE(_metadata, '{}'::jsonb) || jsonb_build_object('step', _step)
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.current_workspace_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT wm.workspace_id
    FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid() AND wm.status = 'active'
    ORDER BY wm.created_at
    LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.save_agent_draft(_agent_id uuid, _config jsonb, _expected_revision integer)
 RETURNS agent_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    current_draft public.agent_drafts;
    saved_draft public.agent_drafts;
    target_workspace_id UUID;
BEGIN
    SELECT a.workspace_id
      INTO target_workspace_id
      FROM public.agents a
     WHERE a.id = _agent_id;

    IF target_workspace_id IS NULL OR NOT public.can_edit_agent(target_workspace_id) THEN
        RAISE EXCEPTION 'Sem permissão para editar este agente'
            USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(_config) <> 'object'
       OR COALESCE((_config ->> 'schemaVersion')::INTEGER, 0) <> 1 THEN
        RAISE EXCEPTION 'Configuração do agente inválida'
            USING ERRCODE = '22023';
    END IF;

    SELECT d.*
      INTO current_draft
      FROM public.agent_drafts d
     WHERE d.agent_id = _agent_id
     FOR UPDATE;

    IF current_draft.id IS NULL THEN
        RAISE EXCEPTION 'Rascunho do agente não encontrado'
            USING ERRCODE = 'P0002';
    END IF;

    IF current_draft.revision <> _expected_revision THEN
        RAISE EXCEPTION 'Rascunho alterado por outra sessão; recarregue antes de salvar'
            USING ERRCODE = '40001',
                  DETAIL = format('expected=%s actual=%s', _expected_revision, current_draft.revision);
    END IF;

    UPDATE public.agent_drafts
       SET config = _config,
           revision = revision + 1,
           updated_by = auth.uid(),
           updated_at = now()
     WHERE id = current_draft.id
     RETURNING * INTO saved_draft;

    INSERT INTO public.agent_audit_log (
        workspace_id, agent_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
        target_workspace_id,
        _agent_id,
        auth.uid(),
        'agent.draft_saved',
        'agent_draft',
        saved_draft.id,
        jsonb_build_object(
            'previousRevision', current_draft.revision,
            'revision', saved_draft.revision
        )
    );

    RETURN saved_draft;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_nina_processing(p_message_id uuid, p_conversation_id uuid, p_contact_id uuid, p_delay_seconds integer DEFAULT 10, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 42));

  DELETE FROM public.nina_processing_queue
  WHERE conversation_id = p_conversation_id
    AND status = 'pending';

  INSERT INTO public.nina_processing_queue
    (message_id, conversation_id, contact_id, priority, scheduled_for, context_data)
  VALUES
    (p_message_id, p_conversation_id, p_contact_id, 1,
     now() + make_interval(secs => GREATEST(p_delay_seconds, 0)),
     p_context)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_nina_processing_batch(p_limit integer DEFAULT 50)
 RETURNS SETOF nina_processing_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    UPDATE public.nina_processing_queue
    SET status = 'failed',
        error_message = 'Abandonado em processing repetidamente — provável falha estrutural no processamento deste item.',
        updated_at = now()
    WHERE status = 'processing'
      AND updated_at < now() - interval '10 minutes'
      AND retry_count >= 4;

    RETURN QUERY
    WITH cte AS (
        SELECT id
        FROM public.nina_processing_queue
        WHERE (
                status = 'pending'
                AND (scheduled_for IS NULL OR scheduled_for <= now())
              )
           OR (
                status = 'processing'
                AND updated_at < now() - interval '10 minutes'
                AND retry_count < 4
              )
        ORDER BY priority DESC, scheduled_for ASC NULLS FIRST, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    UPDATE public.nina_processing_queue n
    SET status = 'processing',
        updated_at = now(),
        retry_count = n.retry_count + CASE WHEN n.status = 'processing' THEN 1 ELSE 0 END
    WHERE n.id IN (SELECT id FROM cte)
    RETURNING n.*;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.conversations 
  SET last_message_at = NOW(), updated_at = NOW()
  WHERE id = NEW.conversation_id;
  
  UPDATE public.contacts 
  SET last_activity = NOW(), updated_at = NOW()
  WHERE id = (SELECT contact_id FROM public.conversations WHERE id = NEW.conversation_id);
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = _workspace_id
          AND wm.user_id = _user_id
          AND wm.status = 'active'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = _workspace_id
          AND wm.user_id = _user_id
          AND wm.status = 'active'
          AND wm.role = 'admin'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.review_evaluation_result(_result_id uuid, _verdict text, _accept_scenario boolean DEFAULT false)
 RETURNS eval_results
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    result public.eval_results;
    scenario public.golden_cases;
    agent_record public.agents;
BEGIN
    IF _verdict NOT IN ('keep', 'reject', 'neutral') THEN
        RAISE EXCEPTION 'Veredito inválido' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO result FROM public.eval_results WHERE id = _result_id FOR UPDATE;
    IF result.id IS NULL OR NOT public.can_edit_agent(result.workspace_id) THEN
        RAISE EXCEPTION 'Resultado não encontrado ou sem permissão' USING ERRCODE = '42501';
    END IF;

    IF _accept_scenario AND _verdict <> 'keep' THEN
        RAISE EXCEPTION 'Só é possível aceitar um cenário ao marcar que o comportamento pode ser mantido'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.eval_results
       SET reviewer_verdict = _verdict,
           reviewed_by = auth.uid(),
           reviewed_at = now()
     WHERE id = _result_id
     RETURNING * INTO result;

    SELECT * INTO scenario FROM public.golden_cases WHERE id = result.case_id FOR UPDATE;
    IF scenario.id IS NOT NULL THEN
        IF _accept_scenario THEN
            UPDATE public.golden_cases
               SET accepted_at = now(), accepted_by = auth.uid()
             WHERE id = scenario.id;
        ELSIF _verdict <> 'keep' AND scenario.accepted_at IS NOT NULL THEN
            UPDATE public.golden_cases
               SET accepted_at = NULL, accepted_by = NULL
             WHERE id = scenario.id;
        END IF;
    END IF;

    SELECT * INTO agent_record FROM public.agents WHERE workspace_id = result.workspace_id LIMIT 1;
    IF agent_record.id IS NOT NULL THEN
        INSERT INTO public.agent_audit_log (
            workspace_id, agent_id, actor_user_id, action, entity_type, entity_id, metadata
        ) VALUES (
            result.workspace_id, agent_record.id, auth.uid(),
            'agent.evaluation_result_reviewed', 'eval_result', result.id,
            jsonb_build_object(
                'verdict', _verdict,
                'acceptedScenario', _accept_scenario,
                'caseId', result.case_id,
                'runId', result.run_id
            )
        );
    END IF;

    RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_create_deal_on_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage_id uuid;
BEGIN
  -- Busca o primeiro estágio ativo e não-sistema para iniciar o lead
  SELECT id INTO v_stage_id
  FROM public.pipeline_stages
  WHERE is_active = true
    AND (is_system = false OR is_system IS NULL)
  ORDER BY position ASC
  LIMIT 1;

  -- Se não houver estágio configurado, não quebra o INSERT do contato
  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.deals (
    contact_id,
    title,
    stage_id,
    stage,
    user_id,
    value,
    priority
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.name, 'Lead'),
    v_stage_id,
    'new',
    NEW.user_id,
    0,
    'medium'
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_workspace_knowledge(_workspace_id uuid, p_query text, p_limit integer DEFAULT 6)
 RETURNS TABLE(source_type text, source_id uuid, title text, content text, rank real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH q AS (SELECT websearch_to_tsquery('portuguese', p_query) AS tsq),
    fact_hits AS (
        SELECT 'fact'::TEXT AS source_type,
               f.id AS source_id,
               f.title,
               f.fact AS content,
               (COALESCE(ts_rank(f.fts, q.tsq), 0) * 2.0
                + similarity(coalesce(f.question, '') || ' ' || f.fact, p_query))::REAL AS rank
        FROM public.knowledge_facts f CROSS JOIN q
        WHERE f.workspace_id = _workspace_id
          AND f.status = 'confirmed' AND f.is_active
          AND f.valid_from <= now()
          AND (f.expires_at IS NULL OR f.expires_at > now())
          AND (f.fts @@ q.tsq OR similarity(coalesce(f.question, '') || ' ' || f.fact, p_query) > 0.12)
    ),
    chunk_hits AS (
        SELECT 'chunk'::TEXT AS source_type,
               c.id AS source_id,
               d.title,
               c.content,
               (COALESCE(ts_rank(c.fts, q.tsq), 0) + similarity(c.content, p_query) * 0.5)::REAL AS rank
        FROM public.knowledge_chunks c
        JOIN public.knowledge_documents d ON d.id = c.document_id
          AND d.workspace_id = _workspace_id AND d.status = 'approved' AND d.is_active
        CROSS JOIN q
        WHERE c.workspace_id = _workspace_id
          AND (c.fts @@ q.tsq OR similarity(c.content, p_query) > 0.12)
    )
    SELECT * FROM (SELECT * FROM fact_hits UNION ALL SELECT * FROM chunk_hits) hits
    ORDER BY rank DESC LIMIT greatest(p_limit, 1);
$function$
;

CREATE OR REPLACE FUNCTION public.bootstrap_current_user(_full_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid();
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
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_conversation_state(p_conversation_id uuid, p_new_state text, p_action text DEFAULT NULL::text, p_context jsonb DEFAULT NULL::jsonb)
 RETURNS conversation_states
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    state_record public.conversation_states;
BEGIN
    INSERT INTO public.conversation_states (
        conversation_id, current_state, last_action, last_action_at, scheduling_context
    )
    VALUES (
        p_conversation_id, p_new_state, p_action, now(), COALESCE(p_context, '{}')
    )
    ON CONFLICT (conversation_id) 
    DO UPDATE SET
        current_state = EXCLUDED.current_state,
        last_action = EXCLUDED.last_action,
        last_action_at = EXCLUDED.last_action_at,
        scheduling_context = CASE 
            WHEN EXCLUDED.scheduling_context = '{}' THEN conversation_states.scheduling_context
            ELSE EXCLUDED.scheduling_context
        END,
        updated_at = now()
    RETURNING * INTO state_record;
    
    RETURN state_record;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_current_agent_context()
 RETURNS TABLE(workspace_id uuid, workspace_name text, member_role workspace_member_role, can_publish boolean, agent_id uuid, agent_name text, agent_status text, published_version_id uuid, draft_id uuid, draft_config jsonb, draft_revision integer, base_version_id uuid, draft_updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        w.id,
        w.name,
        wm.role,
        (wm.role = 'admin' OR wm.can_publish_agent),
        a.id,
        a.name,
        a.status,
        a.published_version_id,
        d.id,
        d.config,
        d.revision,
        d.base_version_id,
        d.updated_at
    FROM public.workspace_members wm
    JOIN public.workspaces w
      ON w.id = wm.workspace_id AND w.status = 'active'
    JOIN public.agents a
      ON a.workspace_id = w.id AND a.status <> 'archived'
    JOIN public.agent_drafts d
      ON d.agent_id = a.id
    WHERE wm.user_id = auth.uid()
      AND wm.status = 'active'
    ORDER BY wm.created_at
    LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.search_knowledge(p_query text, p_limit integer DEFAULT 6)
 RETURNS TABLE(source_type text, source_id uuid, title text, content text, rank real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT * FROM public.search_workspace_knowledge(public.current_workspace_id(), p_query, p_limit);
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_edge_secrets(p_project_url text, p_service_role_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_current text;
BEGIN
  IF coalesce(p_project_url, '') = '' OR coalesce(p_service_role_key, '') = '' THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ensure_edge_secrets', 42));

  SELECT id, decrypted_secret INTO v_id, v_current
  FROM vault.decrypted_secrets WHERE name = 'edge_project_url';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_project_url, 'edge_project_url');
  ELSIF v_current IS DISTINCT FROM p_project_url THEN
    PERFORM vault.update_secret(v_id, p_project_url);
  END IF;

  SELECT id, decrypted_secret INTO v_id, v_current
  FROM vault.decrypted_secrets WHERE name = 'edge_service_role_key';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_service_role_key, 'edge_service_role_key');
  ELSIF v_current IS DISTINCT FROM p_service_role_key THEN
    PERFORM vault.update_secret(v_id, p_service_role_key);
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_send_queue_batch(p_limit integer DEFAULT 10)
 RETURNS SETOF send_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    WITH poisoned AS (
        UPDATE public.send_queue
        SET status = 'failed',
            error_message = 'Abandonado em processing repetidamente — provável falha estrutural no envio deste item.',
            updated_at = now()
        WHERE status = 'processing'
          AND updated_at < now() - interval '5 minutes'
          AND retry_count >= 4
        RETURNING message_id
    )
    UPDATE public.messages m
    SET status = 'failed',
        metadata = COALESCE(m.metadata, '{}'::jsonb)
          || jsonb_build_object('send_error', 'Envio abandonado após falhas repetidas.')
    WHERE m.id IN (SELECT message_id FROM poisoned WHERE message_id IS NOT NULL);

    RETURN QUERY
    WITH cte AS (
        SELECT id
        FROM public.send_queue
        WHERE (
                status = 'pending'
                AND (scheduled_at IS NULL OR scheduled_at <= now())
              )
           OR (
                status = 'processing'
                AND updated_at < now() - interval '5 minutes'
                AND retry_count < 4
              )
        ORDER BY priority DESC, scheduled_at ASC NULLS FIRST, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    UPDATE public.send_queue s
    SET status = 'processing',
        updated_at = now(),
        retry_count = s.retry_count + CASE WHEN s.status = 'processing' THEN 1 ELSE 0 END
    WHERE s.id IN (SELECT id FROM cte)
    RETURNING s.*;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name');
  
  -- Give first user admin role, others get user role
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_processed_message_queue()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    DELETE FROM public.message_grouping_queue 
    WHERE processed = true AND created_at < now() - interval '1 hour';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_message_processing_batch(p_limit integer DEFAULT 50)
 RETURNS SETOF message_processing_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    RETURN QUERY
    WITH cte AS (
        SELECT id
        FROM public.message_processing_queue
        WHERE status = 'pending'
          AND (scheduled_for IS NULL OR scheduled_for <= now())
        ORDER BY priority DESC, scheduled_for ASC NULLS FIRST, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    UPDATE public.message_processing_queue m
    SET status = 'processing', updated_at = now()
    WHERE m.id IN (SELECT id FROM cte)
    RETURNING m.*;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_auth_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid()
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.create_deal_for_new_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  first_stage_id UUID;
BEGIN
  -- Buscar primeiro estágio do pipeline DO MESMO USER_ID DO CONTATO
  SELECT id INTO first_stage_id 
  FROM public.pipeline_stages 
  WHERE is_active = true 
    AND (user_id = NEW.user_id OR user_id IS NULL)
  ORDER BY position 
  LIMIT 1;
  
  IF first_stage_id IS NULL THEN
    RAISE NOTICE 'No pipeline stages found, skipping deal creation for contact %', NEW.id;
    RETURN NEW;
  END IF;
  
  -- Criar deal COM O MESMO USER_ID DO CONTATO
  INSERT INTO deals (contact_id, title, company, stage, stage_id, priority, user_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.name, NEW.call_name, 'Novo Lead'),
    NULL,
    'new',
    first_stage_id,
    'medium',
    NEW.user_id
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_publish_agent(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = _workspace_id
          AND wm.user_id = _user_id
          AND wm.status = 'active'
          AND (wm.role = 'admin' OR wm.can_publish_agent)
    );
$function$
;

CREATE OR REPLACE FUNCTION public.update_client_memory(p_contact_id uuid, p_new_memory jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
    UPDATE public.contacts 
    SET client_memory = p_new_memory, updated_at = now()
    WHERE id = p_contact_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_appointment_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.workspace_id IS NULL THEN
        SELECT wm.workspace_id INTO NEW.workspace_id
        FROM public.workspace_members wm
        WHERE wm.user_id = COALESCE(NEW.user_id, auth.uid())
          AND wm.status = 'active'
        ORDER BY wm.created_at
        LIMIT 1;
    END IF;
    IF NEW.workspace_id IS NULL THEN
        RAISE EXCEPTION 'Workspace não encontrado para o agendamento'
            USING ERRCODE = '23502';
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.write_knowledge_document(_document_id uuid, _title text, _content text, _doc_type text, _source_url text, _fingerprint text, _status text, _is_active boolean, _ingestion_report jsonb, _error_message text, _chunks text[])
 RETURNS knowledge_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    workspace UUID := public.current_workspace_id();
    document public.knowledge_documents;
    new_chunk_count INTEGER := COALESCE(array_length(_chunks, 1), 0);
BEGIN
    IF workspace IS NULL OR NOT public.can_edit_agent(workspace) THEN
        RAISE EXCEPTION 'Sem permissão para gerenciar materiais' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(char_length(trim(_title)), 0) = 0 THEN
        RAISE EXCEPTION 'O título do material é obrigatório' USING ERRCODE = '22023';
    END IF;
    IF char_length(COALESCE(_content, '')) > 220000 OR new_chunk_count > 500 THEN
        RAISE EXCEPTION 'O material ultrapassa o limite de ingestão' USING ERRCODE = '22023';
    END IF;
    IF _doc_type NOT IN ('texto', 'faq', 'url')
       OR _status NOT IN ('processing', 'approved', 'needs_review', 'error', 'archived') THEN
        RAISE EXCEPTION 'Tipo ou status de material inválido' USING ERRCODE = '22023';
    END IF;

    IF _document_id IS NULL THEN
        SELECT * INTO document
          FROM public.knowledge_documents d
         WHERE d.workspace_id = workspace
           AND d.fingerprint = _fingerprint
         LIMIT 1;
        IF document.id IS NOT NULL THEN
            RETURN document;
        END IF;

        BEGIN
            INSERT INTO public.knowledge_documents (
                workspace_id, title, content, doc_type, source_url, fingerprint,
                status, is_active, ingestion_report, error_message, chunk_count
            ) VALUES (
                workspace, trim(_title), COALESCE(_content, ''), _doc_type,
                NULLIF(trim(COALESCE(_source_url, '')), ''), _fingerprint,
                _status, _is_active, COALESCE(_ingestion_report, '{}'::JSONB),
                NULLIF(trim(COALESCE(_error_message, '')), ''), new_chunk_count
            ) RETURNING * INTO document;
        EXCEPTION WHEN unique_violation THEN
            SELECT * INTO document
              FROM public.knowledge_documents d
             WHERE d.workspace_id = workspace AND d.fingerprint = _fingerprint
             LIMIT 1;
            RETURN document;
        END;
    ELSE
        SELECT * INTO document
          FROM public.knowledge_documents d
         WHERE d.id = _document_id AND d.workspace_id = workspace
         FOR UPDATE;
        IF document.id IS NULL THEN
            RAISE EXCEPTION 'Material não encontrado' USING ERRCODE = 'P0002';
        END IF;

        UPDATE public.knowledge_documents
           SET title = trim(_title),
               content = COALESCE(_content, ''),
               doc_type = _doc_type,
               source_url = NULLIF(trim(COALESCE(_source_url, '')), ''),
               fingerprint = _fingerprint,
               status = _status,
               is_active = _is_active,
               ingestion_report = COALESCE(_ingestion_report, '{}'::JSONB),
               error_message = NULLIF(trim(COALESCE(_error_message, '')), ''),
               chunk_count = new_chunk_count
         WHERE id = document.id
         RETURNING * INTO document;

        DELETE FROM public.knowledge_chunks WHERE document_id = document.id;
    END IF;

    IF new_chunk_count > 0 THEN
        INSERT INTO public.knowledge_chunks (workspace_id, document_id, chunk_index, content)
        SELECT workspace, document.id, ordinal - 1, content
          FROM unnest(_chunks) WITH ORDINALITY AS chunks(content, ordinal);
    END IF;

    INSERT INTO public.agent_audit_log (
        workspace_id, agent_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    SELECT workspace, a.id, auth.uid(),
           CASE WHEN _document_id IS NULL THEN 'agent.knowledge_document_created'
                ELSE 'agent.knowledge_document_updated' END,
           'knowledge_document', document.id,
           jsonb_build_object('status', _status, 'chunk_count', new_chunk_count, 'doc_type', _doc_type)
      FROM public.agents a
     WHERE a.workspace_id = workspace;

    RETURN document;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_edit_agent(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = _workspace_id
          AND wm.user_id = _user_id
          AND wm.status = 'active'
          AND wm.role IN ('admin', 'editor')
    );
$function$
;

CREATE OR REPLACE FUNCTION public.update_conversation_last_message_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_id uuid;
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.sent_at,
      updated_at = NOW()
  WHERE id = NEW.conversation_id;

  SELECT contact_id INTO v_contact_id
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  IF v_contact_id IS NOT NULL THEN
    UPDATE public.contacts
    SET last_activity = NEW.sent_at,
        updated_at = NOW()
    WHERE id = v_contact_id;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.audit_workspace_membership_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    membership public.workspace_members;
BEGIN
    membership := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

    INSERT INTO public.agent_audit_log (
        workspace_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        membership.workspace_id,
        auth.uid(),
        CASE TG_OP
            WHEN 'INSERT' THEN 'workspace.member_added'
            WHEN 'UPDATE' THEN 'workspace.member_updated'
            ELSE 'workspace.member_removed'
        END,
        'workspace_member',
        membership.id,
        jsonb_build_object(
            'targetUserId', membership.user_id,
            'role', membership.role,
            'canPublishAgent', membership.can_publish_agent,
            'status', membership.status
        )
    );

    RETURN membership;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.review_agent_suggestion(_suggestion_id uuid, _status text, _applied_entity_type text DEFAULT NULL::text, _applied_entity_id uuid DEFAULT NULL::uuid)
 RETURNS agent_suggestions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    suggestion public.agent_suggestions;
BEGIN
    IF _status NOT IN ('accepted', 'rejected', 'applied') THEN
        RAISE EXCEPTION 'Status de revisão inválido';
    END IF;
    SELECT * INTO suggestion FROM public.agent_suggestions WHERE id = _suggestion_id FOR UPDATE;
    IF suggestion.id IS NULL OR NOT public.can_edit_agent(suggestion.workspace_id) THEN
        RAISE EXCEPTION 'Sugestão não encontrada ou sem permissão' USING ERRCODE = '42501';
    END IF;
    IF suggestion.status <> 'pending' AND NOT (suggestion.status = 'accepted' AND _status = 'applied') THEN
        RAISE EXCEPTION 'Esta sugestão já foi revisada';
    END IF;
    UPDATE public.agent_suggestions
       SET status = _status,
           reviewed_by = auth.uid(),
           reviewed_at = now(),
           applied_entity_type = _applied_entity_type,
           applied_entity_id = _applied_entity_id
     WHERE id = _suggestion_id
     RETURNING * INTO suggestion;
    INSERT INTO public.agent_audit_log (
        workspace_id, agent_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
        suggestion.workspace_id, suggestion.agent_id, auth.uid(),
        'agent.suggestion_reviewed', 'agent_suggestion', suggestion.id,
        jsonb_build_object('status', _status, 'appliedEntityType', _applied_entity_type, 'appliedEntityId', _applied_entity_id)
    );
    RETURN suggestion;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_immutable_agent_record_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_knowledge_ingestion_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    subject TEXT;
BEGIN
    subject := COALESCE(auth.uid()::TEXT, 'service-role');
    IF NOT public.consume_agent_rate_limit(
        NEW.workspace_id,
        subject,
        'knowledge_ingestion',
        40,
        3600
    ) THEN
        RAISE EXCEPTION 'Limite de materiais atingido. Aguarde antes de enviar novos arquivos.'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_knowledge_fact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    NEW.title := COALESCE(
        NULLIF(trim(NEW.title), ''),
        NULLIF(trim(NEW.question), ''),
        initcap(NEW.category),
        'Informação confirmada'
    );
    IF NEW.status = 'confirmed' THEN
        NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
        NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
    END IF;
    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() THEN
        NEW.status := 'expired';
    END IF;
    RETURN NEW;
END;
$function$
;

alter table public.knowledge_facts alter column always_include set default false;

alter table public.knowledge_facts alter column created_at set default now();

alter table public.knowledge_facts alter column updated_at set default now();

alter table public.knowledge_facts alter column status set default 'confirmed'::text;

alter table public.knowledge_facts alter column valid_from set default now();

alter table public.eval_runs alter column id set default gen_random_uuid();

alter table public.eval_runs alter column status set default 'running'::text;

alter table public.eval_runs alter column total_cases set default 0;

alter table public.eval_runs alter column passed set default 0;

alter table public.eval_runs alter column failed set default 0;

alter table public.eval_runs alter column errored set default 0;

alter table public.eval_runs alter column prompt_source set default 'atual'::text;

alter table public.eval_runs alter column created_at set default now();

alter table public.eval_runs alter column critical_failures set default 0;

alter table public.eval_runs alter column warnings set default 0;

alter table public.eval_runs alter column unstable set default 0;

alter table public.eval_runs alter column technical_failures set default 0;

alter table public.eval_runs alter column gate_status set default 'blocked'::text;

alter table public.eval_runs alter column accepted_warnings set default 0;

alter table public.golden_cases alter column id set default gen_random_uuid();

alter table public.golden_cases alter column category set default 'factual'::text;

alter table public.golden_cases alter column origin set default 'manual'::text;

alter table public.golden_cases alter column is_active set default true;

alter table public.golden_cases alter column created_at set default now();

alter table public.golden_cases alter column updated_at set default now();

alter table public.golden_cases alter column severity set default 'warning'::text;

alter table public.golden_cases alter column messages set default '[]'::jsonb;

alter table public.pipeline_stages alter column id set default gen_random_uuid();

alter table public.pipeline_stages alter column color set default 'border-muted-foreground'::text;

alter table public.pipeline_stages alter column is_system set default false;

alter table public.pipeline_stages alter column is_active set default true;

alter table public.pipeline_stages alter column created_at set default now();

alter table public.pipeline_stages alter column updated_at set default now();

alter table public.pipeline_stages alter column is_ai_managed set default false;

alter table public.conversations alter column id set default gen_random_uuid();

alter table public.conversations alter column status set default 'nina'::conversation_status;

alter table public.conversations alter column is_active set default true;

alter table public.conversations alter column tags set default '{}'::text[];

alter table public.conversations alter column nina_context set default '{}'::jsonb;

alter table public.conversations alter column metadata set default '{}'::jsonb;

alter table public.conversations alter column started_at set default now();

alter table public.conversations alter column last_message_at set default now();

alter table public.conversations alter column created_at set default now();

alter table public.conversations alter column updated_at set default now();

alter table public.conversations alter column channel set default 'whatsapp'::text;

alter table public.messages alter column id set default gen_random_uuid();

alter table public.messages alter column type set default 'text'::message_type;

alter table public.messages alter column status set default 'sent'::message_status;

alter table public.messages alter column processed_by_nina set default false;

alter table public.messages alter column metadata set default '{}'::jsonb;

alter table public.messages alter column sent_at set default now();

alter table public.messages alter column created_at set default now();

alter table public.nina_settings alter column id set default gen_random_uuid();

alter table public.nina_settings alter column is_active set default true;

alter table public.nina_settings alter column elevenlabs_voice_id set default '33B4UnXyTNbgLmdEDh5P'::text;

alter table public.nina_settings alter column elevenlabs_model set default 'eleven_turbo_v2_5'::text;

alter table public.nina_settings alter column elevenlabs_stability set default 0.75;

alter table public.nina_settings alter column elevenlabs_similarity_boost set default 0.80;

alter table public.nina_settings alter column elevenlabs_style set default 0.30;

alter table public.nina_settings alter column elevenlabs_speaker_boost set default true;

alter table public.nina_settings alter column elevenlabs_speed set default 1.0;

alter table public.nina_settings alter column whatsapp_verify_token set default 'viver-de-ia-nina-webhook'::text;

alter table public.nina_settings alter column auto_response_enabled set default true;

alter table public.nina_settings alter column adaptive_response_enabled set default true;

alter table public.nina_settings alter column message_breaking_enabled set default true;

alter table public.nina_settings alter column response_delay_min set default 1000;

alter table public.nina_settings alter column response_delay_max set default 3000;

alter table public.nina_settings alter column timezone set default 'America/Sao_Paulo'::text;

alter table public.nina_settings alter column business_hours_start set default '09:00:00'::time without time zone;

alter table public.nina_settings alter column business_hours_end set default '18:00:00'::time without time zone;

alter table public.nina_settings alter column business_days set default '{1,2,3,4,5}'::integer[];

alter table public.nina_settings alter column async_booking_enabled set default false;

alter table public.nina_settings alter column route_all_to_receiver_enabled set default false;

alter table public.nina_settings alter column created_at set default now();

alter table public.nina_settings alter column updated_at set default now();

alter table public.nina_settings alter column ai_model_mode set default 'flash'::text;

alter table public.nina_settings alter column audio_response_enabled set default false;

alter table public.nina_settings alter column ai_scheduling_enabled set default true;

alter table public.nina_settings alter column ai_provider set default 'lovable'::text;

alter table public.nina_settings alter column demo_mode_enabled set default false;

alter table public.team_functions alter column id set default gen_random_uuid();

alter table public.team_functions alter column is_active set default true;

alter table public.team_functions alter column created_at set default now();

alter table public.team_functions alter column updated_at set default now();

alter table public.prompt_versions alter column id set default gen_random_uuid();

alter table public.prompt_versions alter column blocks set default '{}'::jsonb;

alter table public.prompt_versions alter column source set default 'manual'::text;

alter table public.prompt_versions alter column created_at set default now();

alter table public.tag_definitions alter column id set default gen_random_uuid();

alter table public.tag_definitions alter column color set default '#3b82f6'::text;

alter table public.tag_definitions alter column category set default 'custom'::text;

alter table public.tag_definitions alter column is_active set default true;

alter table public.tag_definitions alter column created_at set default now();

alter table public.tag_definitions alter column updated_at set default now();

alter table public.workspace_members alter column id set default gen_random_uuid();

alter table public.workspace_members alter column role set default 'observer'::workspace_member_role;

alter table public.workspace_members alter column can_publish_agent set default false;

alter table public.workspace_members alter column status set default 'active'::text;

alter table public.workspace_members alter column created_at set default now();

alter table public.workspace_members alter column updated_at set default now();

alter table public.zernio_webhook_events alter column id set default gen_random_uuid();

alter table public.zernio_webhook_events alter column payload set default '{}'::jsonb;

alter table public.zernio_webhook_events alter column processed set default false;

alter table public.zernio_webhook_events alter column created_at set default now();

alter table public.teams alter column id set default gen_random_uuid();

alter table public.teams alter column color set default '#3b82f6'::text;

alter table public.teams alter column is_active set default true;

alter table public.teams alter column created_at set default now();

alter table public.teams alter column updated_at set default now();

alter table public.pipeline_stages alter column "position" set default 0;

alter table public.deal_activities alter column id set default gen_random_uuid();

alter table public.deal_activities alter column type set default 'note'::text;

alter table public.deal_activities alter column is_completed set default false;

alter table public.deal_activities alter column created_at set default now();

alter table public.deal_activities alter column updated_at set default now();

alter table public.workspaces alter column id set default gen_random_uuid();

alter table public.workspaces alter column status set default 'active'::text;

alter table public.workspaces alter column created_at set default now();

alter table public.workspaces alter column updated_at set default now();

alter table public.agent_drafts alter column id set default gen_random_uuid();

alter table public.agent_drafts alter column config set default '{"schemaVersion": 1}'::jsonb;

alter table public.agent_drafts alter column revision set default 1;

alter table public.agent_drafts alter column created_at set default now();

alter table public.agent_drafts alter column updated_at set default now();

alter table public.agent_suggestions alter column id set default gen_random_uuid();

alter table public.agent_suggestions alter column proposed_change set default '{}'::jsonb;

alter table public.agent_suggestions alter column evidence set default '{}'::jsonb;

alter table public.agent_suggestions alter column status set default 'pending'::text;

alter table public.agent_suggestions alter column created_at set default now();

alter table public.agent_suggestions alter column updated_at set default now();

alter table public.calendar_integrations alter column id set default gen_random_uuid();

alter table public.calendar_integrations alter column provider set default 'google'::text;

alter table public.calendar_integrations alter column calendar_id set default 'primary'::text;

alter table public.calendar_integrations alter column scopes set default '{}'::text[];

alter table public.calendar_integrations alter column status set default 'active'::text;

alter table public.calendar_integrations alter column sync_enabled set default true;

alter table public.calendar_integrations alter column create_meet set default true;

alter table public.calendar_integrations alter column time_zone set default 'America/Sao_Paulo'::text;

alter table public.calendar_integrations alter column created_at set default now();

alter table public.calendar_integrations alter column updated_at set default now();

alter table public.agent_operation_rate_limits alter column request_count set default 1;

alter table public.agent_operation_rate_limits alter column created_at set default now();

alter table public.agent_operation_rate_limits alter column updated_at set default now();

alter table public.knowledge_chunks alter column id set default gen_random_uuid();

alter table public.knowledge_chunks alter column chunk_index set default 0;

alter table public.knowledge_chunks alter column created_at set default now();

alter table public.team_members alter column id set default gen_random_uuid();

alter table public.team_members alter column role set default 'agent'::member_role;

alter table public.team_members alter column status set default 'invited'::member_status;

alter table public.team_members alter column weight set default 1;

alter table public.team_members alter column created_at set default now();

alter table public.team_members alter column updated_at set default now();

alter table public.user_roles alter column id set default gen_random_uuid();

alter table public.user_roles alter column role set default 'user'::app_role;

alter table public.user_roles alter column created_at set default now();

alter table public.agent_versions alter column id set default gen_random_uuid();

alter table public.agent_versions alter column source set default 'manual'::text;

alter table public.agent_versions alter column accepted_warnings set default '[]'::jsonb;

alter table public.agent_versions alter column published_at set default now();

alter table public.agent_versions alter column created_at set default now();

alter table public.agent_versions alter column compiler_version set default 'legacy-v1'::text;

alter table public.send_queue alter column id set default gen_random_uuid();

alter table public.send_queue alter column message_type set default 'text'::text;

alter table public.send_queue alter column from_type set default 'nina'::text;

alter table public.send_queue alter column metadata set default '{}'::jsonb;

alter table public.send_queue alter column status set default 'pending'::queue_status;

alter table public.send_queue alter column priority set default 1;

alter table public.send_queue alter column retry_count set default 0;

alter table public.send_queue alter column scheduled_at set default now();

alter table public.send_queue alter column created_at set default now();

alter table public.send_queue alter column updated_at set default now();

alter table public.message_processing_queue alter column id set default gen_random_uuid();

alter table public.message_processing_queue alter column status set default 'pending'::queue_status;

alter table public.message_processing_queue alter column priority set default 1;

alter table public.message_processing_queue alter column retry_count set default 0;

alter table public.message_processing_queue alter column scheduled_for set default now();

alter table public.message_processing_queue alter column created_at set default now();

alter table public.message_processing_queue alter column updated_at set default now();

alter table public.nina_processing_queue alter column id set default gen_random_uuid();

alter table public.nina_processing_queue alter column status set default 'pending'::queue_status;

alter table public.nina_processing_queue alter column priority set default 1;

alter table public.nina_processing_queue alter column retry_count set default 0;

alter table public.nina_processing_queue alter column scheduled_for set default now();

alter table public.nina_processing_queue alter column created_at set default now();

alter table public.nina_processing_queue alter column updated_at set default now();

alter table public.conversation_states alter column id set default gen_random_uuid();

alter table public.conversation_states alter column current_state set default 'idle'::text;

alter table public.conversation_states alter column scheduling_context set default '{}'::jsonb;

alter table public.conversation_states alter column created_at set default now();

alter table public.conversation_states alter column updated_at set default now();

alter table public.agents alter column id set default gen_random_uuid();

alter table public.agents alter column name set default 'Nina'::text;

alter table public.agents alter column status set default 'configuring'::text;

alter table public.agents alter column created_at set default now();

alter table public.agents alter column updated_at set default now();

alter table public.calendar_oauth_states alter column id set default gen_random_uuid();

alter table public.calendar_oauth_states alter column created_at set default now();

alter table public.agent_audit_log alter column id set default gen_random_uuid();

alter table public.agent_audit_log alter column metadata set default '{}'::jsonb;

alter table public.agent_audit_log alter column created_at set default now();

alter table public.knowledge_documents alter column id set default gen_random_uuid();

alter table public.knowledge_documents alter column doc_type set default 'texto'::text;

alter table public.knowledge_documents alter column is_active set default true;

alter table public.knowledge_documents alter column chunk_count set default 0;

alter table public.knowledge_documents alter column created_at set default now();

alter table public.knowledge_documents alter column updated_at set default now();

alter table public.knowledge_documents alter column status set default 'approved'::text;

alter table public.knowledge_documents alter column ingestion_report set default '{}'::jsonb;

alter table public.agent_runtime_events alter column id set default gen_random_uuid();

alter table public.agent_runtime_events alter column sources set default '[]'::jsonb;

alter table public.agent_runtime_events alter column tools set default '[]'::jsonb;

alter table public.agent_runtime_events alter column guards set default '[]'::jsonb;

alter table public.agent_runtime_events alter column handoff set default false;

alter table public.agent_runtime_events alter column metadata set default '{}'::jsonb;

alter table public.agent_runtime_events alter column created_at set default now();

alter table public.agent_action_runs alter column id set default gen_random_uuid();

alter table public.agent_action_runs alter column mode set default 'live'::text;

alter table public.agent_action_runs alter column status set default 'pending'::text;

alter table public.agent_action_runs alter column input set default '{}'::jsonb;

alter table public.agent_action_runs alter column output set default '{}'::jsonb;

alter table public.agent_action_runs alter column started_at set default now();

alter table public.agent_action_runs alter column created_at set default now();

alter table public.unanswered_questions alter column id set default gen_random_uuid();

alter table public.unanswered_questions alter column status set default 'open'::text;

alter table public.unanswered_questions alter column created_at set default now();

alter table public.unanswered_questions alter column kind set default 'question'::text;

alter table public.unanswered_questions alter column metadata set default '{}'::jsonb;

alter table public.channel_connections alter column id set default gen_random_uuid();

alter table public.channel_connections alter column provider set default 'zernio'::text;

alter table public.channel_connections alter column status set default 'active'::text;

alter table public.channel_connections alter column connected_at set default now();

alter table public.channel_connections alter column metadata set default '{}'::jsonb;

alter table public.channel_connections alter column created_at set default now();

alter table public.channel_connections alter column updated_at set default now();

alter table public.contacts alter column id set default gen_random_uuid();

alter table public.contacts alter column is_business set default false;

alter table public.contacts alter column is_blocked set default false;

alter table public.contacts alter column tags set default '{}'::text[];

alter table public.contacts alter column client_memory set default '{"lead_state": {"role": {"value": null, "status": "unknown"}, "stage": {"value": "new", "status": "confirmed"}, "company": {"value": null, "status": "unknown"}, "opt_out": false, "urgency": {"value": null, "status": "unknown"}, "primary_pain": {"value": null, "status": "unknown"}, "custom_fields": {}, "desired_outcome": {"value": null, "status": "unknown"}, "next_best_action": {"value": "qualify", "status": "inferred"}, "handoff_requested": false, "offering_interest": {"value": null, "status": "unknown"}, "previous_attempts": {"value": null, "status": "unknown"}, "conversation_summary": ""}, "last_updated": null, "lead_profile": {"interests": [], "lead_stage": "new", "objections": [], "products_discussed": [], "communication_style": "unknown", "qualification_score": 0}, "sales_intelligence": {"pain_points": [], "next_best_action": "qualify", "budget_indication": "unknown", "decision_timeline": "unknown"}, "interaction_summary": {"response_pattern": "unknown", "last_contact_reason": "", "total_conversations": 0, "preferred_contact_time": "unknown"}, "conversation_history": []}'::jsonb;

alter table public.contacts alter column first_contact_date set default now();

alter table public.contacts alter column last_activity set default now();

alter table public.contacts alter column created_at set default now();

alter table public.contacts alter column updated_at set default now();

alter table public.eval_results alter column id set default gen_random_uuid();

alter table public.eval_results alter column created_at set default now();

alter table public.eval_results alter column severity set default 'warning'::text;

alter table public.eval_results alter column result_status set default 'not_run'::text;

alter table public.eval_results alter column checker_details set default '{}'::jsonb;

alter table public.eval_results alter column attempts set default 1;

alter table public.appointments alter column id set default gen_random_uuid();

alter table public.appointments alter column duration set default 60;

alter table public.appointments alter column type set default 'meeting'::appointment_type;

alter table public.appointments alter column attendees set default '{}'::text[];

alter table public.appointments alter column status set default 'scheduled'::text;

alter table public.appointments alter column created_at set default now();

alter table public.appointments alter column updated_at set default now();

alter table public.appointments alter column metadata set default '{}'::jsonb;

alter table public.appointments alter column calendar_sync_status set default 'not_connected'::text;

alter table public.deals alter column id set default gen_random_uuid();

alter table public.deals alter column value set default 0;

alter table public.deals alter column stage set default 'new'::text;

alter table public.deals alter column priority set default 'medium'::text;

alter table public.deals alter column tags set default '{}'::text[];

alter table public.deals alter column created_at set default now();

alter table public.deals alter column updated_at set default now();

alter table public.message_grouping_queue alter column id set default gen_random_uuid();

alter table public.message_grouping_queue alter column processed set default false;

alter table public.message_grouping_queue alter column created_at set default now();

alter table public.message_grouping_queue alter column process_after set default (now() + '00:00:20'::interval);

alter table public.profiles alter column id set default gen_random_uuid();

alter table public.profiles alter column created_at set default now();

alter table public.profiles alter column updated_at set default now();

alter table public.knowledge_facts alter column id set default gen_random_uuid();

alter table public.knowledge_facts alter column category set default 'geral'::text;

alter table public.knowledge_facts alter column is_active set default true;

create or replace view public.nina_settings_public with (security_invoker=true) as  SELECT id,
    company_name,
    sdr_name,
    onboarding_completed_at,
    onboarding_dismissed_at,
    ((whatsapp_access_token IS NOT NULL) AND (whatsapp_business_account_id IS NOT NULL) AND (whatsapp_phone_number_id IS NOT NULL)) AS has_whatsapp_cloud,
    (zernio_api_key IS NOT NULL) AS has_zernio,
    (elevenlabs_api_key IS NOT NULL) AS has_elevenlabs,
    (system_prompt_override IS NOT NULL) AS has_custom_prompt,
    (anthropic_api_key IS NOT NULL) AS has_anthropic,
    (openai_api_key IS NOT NULL) AS has_openai,
    is_active,
    updated_at,
    demo_mode_enabled
   FROM nina_settings;

create or replace view public.contacts_with_stats with (security_invoker=true) as  SELECT c.id,
    c.phone_number,
    c.whatsapp_id,
    c.name,
    c.call_name,
    c.email,
    c.profile_picture_url,
    c.is_business,
    c.is_blocked,
    c.blocked_at,
    c.blocked_reason,
    c.tags,
    c.notes,
    c.client_memory,
    c.first_contact_date,
    c.last_activity,
    c.created_at,
    c.updated_at,
    c.user_id,
    COALESCE(msg_stats.total_messages, (0)::bigint) AS total_messages,
    COALESCE(msg_stats.nina_messages, (0)::bigint) AS nina_messages,
    COALESCE(msg_stats.user_messages, (0)::bigint) AS user_messages,
    COALESCE(msg_stats.human_messages, (0)::bigint) AS human_messages
   FROM (contacts c
     LEFT JOIN ( SELECT conv.contact_id,
            count(m.id) AS total_messages,
            count(
                CASE
                    WHEN (m.from_type = 'nina'::message_from) THEN 1
                    ELSE NULL::integer
                END) AS nina_messages,
            count(
                CASE
                    WHEN (m.from_type = 'user'::message_from) THEN 1
                    ELSE NULL::integer
                END) AS user_messages,
            count(
                CASE
                    WHEN (m.from_type = 'human'::message_from) THEN 1
                    ELSE NULL::integer
                END) AS human_messages
           FROM (conversations conv
             JOIN messages m ON ((m.conversation_id = conv.id)))
          GROUP BY conv.contact_id) msg_stats ON ((msg_stats.contact_id = c.id)));

alter table public.channel_connections add constraint channel_connections_platform_check CHECK ((platform = ANY (ARRAY['whatsapp'::text, 'instagram'::text])));

alter table public.channel_connections add constraint channel_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disconnected'::text, 'error'::text])));

alter table public.deal_activities add constraint deal_activities_type_check CHECK ((type = ANY (ARRAY['note'::text, 'call'::text, 'email'::text, 'meeting'::text, 'task'::text])));

alter table public.eval_runs add constraint eval_runs_accepted_warnings_check CHECK ((accepted_warnings >= 0));

alter table public.eval_runs add constraint eval_runs_gate_status_check CHECK ((gate_status = ANY (ARRAY['passed'::text, 'warnings'::text, 'blocked'::text, 'technical_failure'::text])));

alter table public.eval_runs add constraint eval_runs_prompt_source_check CHECK ((prompt_source = ANY (ARRAY['atual'::text, 'alternativo'::text])));

alter table public.agent_versions add constraint agent_versions_accepted_warnings_check CHECK ((jsonb_typeof(accepted_warnings) = 'array'::text));

alter table public.agent_versions add constraint agent_versions_config_check CHECK ((jsonb_typeof(config) = 'object'::text));

alter table public.eval_runs add constraint eval_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])));

alter table public.golden_cases add constraint golden_cases_category_check CHECK ((category = ANY (ARRAY['factual'::text, 'dificil'::text, 'fora_de_escopo'::text, 'adversarial'::text, 'emocional'::text, 'acao'::text, 'seguranca'::text, 'handoff'::text])));

alter table public.golden_cases add constraint golden_cases_expected_behavior_check CHECK ((expected_behavior = ANY (ARRAY['responder'::text, 'recusar'::text, 'transferir'::text, 'agendar'::text, 'opt_out'::text])));

alter table public.golden_cases add constraint golden_cases_origin_check CHECK ((origin = ANY (ARRAY['manual'::text, 'simulador'::text, 'duvida'::text, 'recomendado'::text, 'automatico'::text])));

alter table public.golden_cases add constraint golden_cases_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'warning'::text])));

alter table public.workspace_members add constraint workspace_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'invited'::text, 'disabled'::text])));

alter table public.knowledge_facts add constraint knowledge_facts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'needs_review'::text, 'expired'::text, 'archived'::text])));

alter table public.nina_settings add constraint nina_settings_ai_model_mode_check CHECK ((ai_model_mode = ANY (ARRAY['flash'::text, 'pro'::text, 'pro3'::text, 'adaptive'::text])));

alter table public.nina_settings add constraint nina_settings_ai_provider_check CHECK ((ai_provider = ANY (ARRAY['lovable'::text, 'anthropic'::text, 'openai'::text])));

alter table public.prompt_versions add constraint prompt_versions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'gerador'::text, 'conversas'::text, 'onboarding'::text, 'restauracao'::text])));

alter table public.unanswered_questions add constraint unanswered_questions_kind_check CHECK ((kind = ANY (ARRAY['question'::text, 'conflict'::text, 'unreadable_document'::text, 'expired_fact'::text])));

alter table public.unanswered_questions add constraint unanswered_questions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'ignored'::text])));

alter table public.workspaces add constraint workspaces_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'archived'::text])));

alter table public.agent_versions add constraint agent_versions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'onboarding'::text, 'restoration'::text, 'migration'::text])));

alter table public.agent_versions add constraint agent_versions_version_number_check CHECK ((version_number > 0));

alter table public.agent_drafts add constraint agent_drafts_config_check CHECK ((jsonb_typeof(config) = 'object'::text));

alter table public.agent_drafts add constraint agent_drafts_config_check1 CHECK ((COALESCE(((config ->> 'schemaVersion'::text))::integer, 0) = 1));

alter table public.agent_drafts add constraint agent_drafts_revision_check CHECK ((revision > 0));

alter table public.agent_suggestions add constraint agent_suggestions_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text));

alter table public.agent_suggestions add constraint agent_suggestions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'applied'::text])));

alter table public.agent_suggestions add constraint agent_suggestions_suggestion_type_check CHECK ((suggestion_type = ANY (ARRAY['new_fact'::text, 'new_faq'::text, 'new_example'::text, 'new_test_scenario'::text, 'commercial_rule'::text, 'tone_adjustment'::text, 'handoff_rule'::text, 'missing_material'::text])));

alter table public.eval_results add constraint eval_results_attempts_check CHECK ((attempts > 0));

alter table public.eval_results add constraint eval_results_result_status_check CHECK ((result_status = ANY (ARRAY['passed'::text, 'warning'::text, 'critical_failure'::text, 'unstable'::text, 'not_run'::text, 'technical_failure'::text])));

alter table public.eval_results add constraint eval_results_reviewer_verdict_check CHECK (((reviewer_verdict IS NULL) OR (reviewer_verdict = ANY (ARRAY['keep'::text, 'reject'::text, 'neutral'::text]))));

alter table public.eval_results add constraint eval_results_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'warning'::text])));

alter table public.eval_results add constraint eval_results_verdict_check CHECK ((verdict = ANY (ARRAY['aprovado'::text, 'reprovado'::text, 'erro'::text])));

alter table public.agent_suggestions add constraint agent_suggestions_proposed_change_check CHECK ((jsonb_typeof(proposed_change) = 'object'::text));

alter table public.knowledge_documents add constraint knowledge_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['texto'::text, 'faq'::text, 'url'::text])));

alter table public.knowledge_documents add constraint knowledge_documents_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'approved'::text, 'needs_review'::text, 'error'::text, 'archived'::text])));

alter table public.agent_action_runs add constraint agent_action_runs_action_key_check CHECK ((action_key = ANY (ARRAY['check_availability'::text, 'create_appointment'::text, 'reschedule_appointment'::text, 'cancel_appointment'::text, 'human_handoff'::text, 'register_opt_out'::text])));

alter table public.agent_action_runs add constraint agent_action_runs_mode_check CHECK ((mode = ANY (ARRAY['live'::text, 'simulation'::text])));

alter table public.agent_action_runs add constraint agent_action_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'rejected'::text])));

alter table public.agent_audit_log add constraint agent_audit_log_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text));

alter table public.calendar_integrations add constraint calendar_integrations_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'nylas'::text])));

alter table public.appointments add constraint appointments_calendar_sync_status_check CHECK ((calendar_sync_status = ANY (ARRAY['not_connected'::text, 'pending'::text, 'synced'::text, 'error'::text])));

alter table public.agent_operation_rate_limits add constraint agent_operation_rate_limits_request_count_check CHECK ((request_count > 0));

alter table public.agent_operation_rate_limits add constraint agent_operation_rate_limits_subject_key_check CHECK (((char_length(subject_key) >= 1) AND (char_length(subject_key) <= 200)));

alter table public.agent_runtime_events add constraint agent_runtime_events_event_kind_check CHECK ((event_kind = ANY (ARRAY['response'::text, 'handoff'::text, 'error'::text])));

alter table public.agent_runtime_events add constraint agent_runtime_events_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0)));

alter table public.agents add constraint agents_status_check CHECK ((status = ANY (ARRAY['configuring'::text, 'active'::text, 'attention'::text, 'blocked'::text, 'archived'::text])));

alter table public.agent_operation_rate_limits add constraint agent_operation_rate_limits_operation_check CHECK (((char_length(operation) >= 1) AND (char_length(operation) <= 100)));

alter table public.calendar_integrations add constraint calendar_integrations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'error'::text, 'disconnected'::text])));

alter table public.agent_runtime_events add constraint agent_runtime_events_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL;

alter table public.conversations add constraint conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

alter table public.appointments add constraint appointments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.appointments add constraint appointments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;

alter table public.calendar_oauth_states add constraint calendar_oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.messages add constraint messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

alter table public.messages add constraint messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES messages(id);

alter table public.deals add constraint deals_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

alter table public.deals add constraint deals_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES team_members(id);

alter table public.deals add constraint deals_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id);

alter table public.deals add constraint deals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.golden_cases add constraint golden_cases_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.golden_cases add constraint golden_cases_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table public.knowledge_chunks add constraint knowledge_chunks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table public.team_members add constraint team_members_function_id_fkey FOREIGN KEY (function_id) REFERENCES team_functions(id) ON DELETE SET NULL;

alter table public.knowledge_facts add constraint knowledge_facts_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.knowledge_facts add constraint knowledge_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table public.nina_settings add constraint nina_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.profiles add constraint profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.team_members add constraint team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

alter table public.team_members add constraint team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.unanswered_questions add constraint unanswered_questions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

alter table public.unanswered_questions add constraint unanswered_questions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

alter table public.unanswered_questions add constraint unanswered_questions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table public.workspace_members add constraint workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table public.workspaces add constraint workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.message_grouping_queue add constraint message_grouping_queue_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id);

alter table public.pipeline_stages add constraint pipeline_stages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.tag_definitions add constraint tag_definitions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.unanswered_questions add constraint unanswered_questions_resolved_fact_id_fkey FOREIGN KEY (resolved_fact_id) REFERENCES knowledge_facts(id) ON DELETE SET NULL;

alter table public.teams add constraint teams_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.user_roles add constraint user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.workspace_members add constraint workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.send_queue add constraint send_queue_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id);

alter table public.conversation_states add constraint conversation_states_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

alter table public.agent_versions add constraint agent_versions_restored_from_version_id_fkey FOREIGN KEY (restored_from_version_id) REFERENCES agent_versions(id) ON DELETE RESTRICT;

alter table public.agent_drafts add constraint agent_drafts_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT;

alter table public.agent_drafts add constraint agent_drafts_base_version_fk FOREIGN KEY (base_version_id) REFERENCES agent_versions(id) ON DELETE RESTRICT;

alter table public.agent_versions add constraint agent_versions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT;

alter table public.agent_versions add constraint agent_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.agent_versions add constraint agent_versions_evaluation_run_id_fkey FOREIGN KEY (evaluation_run_id) REFERENCES eval_runs(id) ON DELETE SET NULL;

alter table public.agent_versions add constraint agent_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;

alter table public.eval_results add constraint eval_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES eval_runs(id) ON DELETE CASCADE;

alter table public.agent_suggestions add constraint agent_suggestions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

alter table public.agent_suggestions add constraint agent_suggestions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.agent_suggestions add constraint agent_suggestions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table public.agent_audit_log add constraint agent_audit_log_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT;

alter table public.agent_runtime_events add constraint agent_runtime_events_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT;

alter table public.agent_action_runs add constraint agent_action_runs_agent_version_id_fkey FOREIGN KEY (agent_version_id) REFERENCES agent_versions(id) ON DELETE SET NULL;

alter table public.agent_action_runs add constraint agent_action_runs_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL;

alter table public.agent_action_runs add constraint agent_action_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;

alter table public.agent_runtime_events add constraint agent_runtime_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;

alter table public.agent_audit_log add constraint agent_audit_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;

alter table public.agent_operation_rate_limits add constraint agent_operation_rate_limits_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table public.agents add constraint agents_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.agents add constraint agents_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.agents add constraint agents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;

alter table public.conversations add constraint conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.calendar_integrations add constraint calendar_integrations_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.contacts add constraint contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.deal_activities add constraint deal_activities_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;

alter table public.deal_activities add constraint deal_activities_created_by_fkey FOREIGN KEY (created_by) REFERENCES team_members(id);

alter table public.eval_runs add constraint eval_runs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

alter table public.eval_runs add constraint eval_runs_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES agent_drafts(id) ON DELETE SET NULL;

alter table public.knowledge_chunks add constraint knowledge_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE;

alter table public.eval_runs add constraint eval_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table public.prompt_versions add constraint prompt_versions_eval_run_id_fkey FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id) ON DELETE SET NULL;

alter table public.team_functions add constraint team_functions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.agent_suggestions add constraint agent_suggestions_source_conversation_id_fkey FOREIGN KEY (source_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

alter table public.eval_results add constraint eval_results_case_id_fkey FOREIGN KEY (case_id) REFERENCES golden_cases(id) ON DELETE SET NULL;

alter table public.agent_drafts add constraint agent_drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.agent_drafts add constraint agent_drafts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.agent_drafts add constraint agent_drafts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;

alter table public.agent_action_runs add constraint agent_action_runs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

alter table public.agent_action_runs add constraint agent_action_runs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

alter table public.eval_results add constraint eval_results_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.eval_results add constraint eval_results_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table public.knowledge_documents add constraint knowledge_documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

alter table public.agent_runtime_events add constraint agent_runtime_events_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

alter table public.agent_runtime_events add constraint agent_runtime_events_agent_version_id_fkey FOREIGN KEY (agent_version_id) REFERENCES agent_versions(id) ON DELETE RESTRICT;

alter table public.agent_audit_log add constraint agent_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.agents add constraint agents_published_version_fk FOREIGN KEY (published_version_id) REFERENCES agent_versions(id) ON DELETE RESTRICT;

alter table public.appointments add constraint appointments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

alter table public.agent_runtime_events add constraint agent_runtime_events_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX idx_unanswered_questions_status ON public.unanswered_questions USING btree (status);

CREATE INDEX idx_conversation_states_current_state ON public.conversation_states USING btree (current_state);

CREATE INDEX idx_knowledge_facts_fts ON public.knowledge_facts USING gin (fts);

CREATE INDEX prompt_versions_created_at_idx ON public.prompt_versions USING btree (created_at DESC);

CREATE INDEX agent_runtime_events_version_created_idx ON public.agent_runtime_events USING btree (agent_version_id, created_at DESC);

CREATE INDEX idx_knowledge_chunks_document_id ON public.knowledge_chunks USING btree (document_id);

CREATE INDEX idx_message_processing_queue_status ON public.message_processing_queue USING btree (status);

CREATE INDEX idx_nina_processing_queue_conversation_id ON public.nina_processing_queue USING btree (conversation_id);

CREATE INDEX idx_message_processing_queue_priority ON public.message_processing_queue USING btree (priority DESC);

CREATE INDEX idx_send_queue_scheduled_at ON public.send_queue USING btree (scheduled_at);

CREATE INDEX unanswered_workspace_status_idx ON public.unanswered_questions USING btree (workspace_id, status, kind, created_at DESC);

CREATE INDEX idx_send_queue_conversation_id ON public.send_queue USING btree (conversation_id);

CREATE INDEX idx_nina_processing_queue_message_id ON public.nina_processing_queue USING btree (message_id);

CREATE INDEX idx_messages_created_at ON public.messages USING btree (created_at DESC);

CREATE INDEX idx_zernio_webhook_events_created_at ON public.zernio_webhook_events USING btree (created_at);

CREATE INDEX idx_contacts_phone_number ON public.contacts USING btree (phone_number);

CREATE INDEX idx_message_processing_queue_scheduled_for ON public.message_processing_queue USING btree (scheduled_for);

CREATE INDEX knowledge_chunks_workspace_idx ON public.knowledge_chunks USING btree (workspace_id, document_id, chunk_index);

CREATE INDEX agent_audit_agent_created_idx ON public.agent_audit_log USING btree (agent_id, created_at DESC);

CREATE INDEX idx_appointments_metadata_source ON public.appointments USING gin (metadata jsonb_path_ops);

CREATE INDEX agent_action_runs_workspace_created_idx ON public.agent_action_runs USING btree (workspace_id, created_at DESC);

CREATE INDEX idx_conversations_last_message_at ON public.conversations USING btree (last_message_at DESC);

CREATE INDEX idx_messages_from_type ON public.messages USING btree (from_type);

CREATE INDEX idx_deal_activities_deal_id ON public.deal_activities USING btree (deal_id);

CREATE UNIQUE INDEX nina_processing_queue_message_unique ON public.nina_processing_queue USING btree (message_id) WHERE (status = ANY (ARRAY['pending'::queue_status, 'processing'::queue_status]));

CREATE INDEX idx_nina_processing_queue_priority ON public.nina_processing_queue USING btree (priority DESC);

CREATE INDEX golden_cases_workspace_accepted_idx ON public.golden_cases USING btree (workspace_id) WHERE (accepted_at IS NOT NULL);

CREATE INDEX idx_knowledge_chunks_trgm ON public.knowledge_chunks USING gin (content gin_trgm_ops);

CREATE INDEX agent_audit_workspace_created_idx ON public.agent_audit_log USING btree (workspace_id, created_at DESC);

CREATE INDEX appointments_workspace_date_idx ON public.appointments USING btree (workspace_id, date, "time", status);

CREATE INDEX idx_contacts_last_activity ON public.contacts USING btree (last_activity DESC);

CREATE INDEX idx_calendar_oauth_states_expires_at ON public.calendar_oauth_states USING btree (expires_at);

CREATE INDEX golden_cases_workspace_active_idx ON public.golden_cases USING btree (workspace_id, severity, created_at) WHERE is_active;

CREATE INDEX idx_knowledge_chunks_fts ON public.knowledge_chunks USING gin (fts);

CREATE INDEX eval_runs_workspace_created_idx ON public.eval_runs USING btree (workspace_id, created_at DESC);

CREATE INDEX knowledge_facts_workspace_status_idx ON public.knowledge_facts USING btree (workspace_id, status, category, updated_at DESC);

CREATE INDEX idx_message_grouping_queue_phone_number_id ON public.message_grouping_queue USING btree (phone_number_id);

CREATE UNIQUE INDEX golden_cases_workspace_scenario_key_unique ON public.golden_cases USING btree (workspace_id, scenario_key);

CREATE INDEX idx_message_grouping_queue_created_at ON public.message_grouping_queue USING btree (created_at);

CREATE INDEX idx_conversations_is_active ON public.conversations USING btree (is_active);

CREATE INDEX agent_versions_workspace_idx ON public.agent_versions USING btree (workspace_id, created_at DESC);

CREATE INDEX idx_deal_activities_created_at ON public.deal_activities USING btree (created_at DESC);

CREATE INDEX agent_action_runs_conversation_idx ON public.agent_action_runs USING btree (conversation_id, created_at DESC);

CREATE INDEX idx_appointments_external_calendar_event ON public.appointments USING btree (calendar_provider, external_calendar_event_id) WHERE (external_calendar_event_id IS NOT NULL);

CREATE INDEX idx_message_grouping_ready ON public.message_grouping_queue USING btree (process_after, processed) WHERE (processed = false);

CREATE INDEX idx_contacts_is_blocked ON public.contacts USING btree (is_blocked);

CREATE INDEX idx_nina_settings_is_active ON public.nina_settings USING btree (is_active);

CREATE INDEX idx_messages_conversation_id ON public.messages USING btree (conversation_id);

CREATE INDEX idx_eval_runs_created ON public.eval_runs USING btree (created_at DESC);

CREATE UNIQUE INDEX idx_conversations_zernio_conversation_id ON public.conversations USING btree (zernio_conversation_id) WHERE (zernio_conversation_id IS NOT NULL);

CREATE INDEX knowledge_documents_workspace_status_idx ON public.knowledge_documents USING btree (workspace_id, status, updated_at DESC);

CREATE INDEX idx_contacts_created_at ON public.contacts USING btree (created_at DESC);

CREATE INDEX idx_knowledge_facts_trgm ON public.knowledge_facts USING gin (fact gin_trgm_ops);

CREATE UNIQUE INDEX messages_whatsapp_message_id_unique ON public.messages USING btree (whatsapp_message_id) WHERE (whatsapp_message_id IS NOT NULL);

CREATE INDEX idx_messages_whatsapp_message_id ON public.messages USING btree (whatsapp_message_id);

CREATE INDEX idx_conversations_created_at ON public.conversations USING btree (created_at DESC);

CREATE INDEX idx_nina_processing_queue_status ON public.nina_processing_queue USING btree (status);

CREATE INDEX idx_conversations_tags ON public.conversations USING gin (tags);

CREATE UNIQUE INDEX idx_messages_zernio_message_id ON public.messages USING btree (zernio_message_id) WHERE (zernio_message_id IS NOT NULL);

CREATE INDEX agent_runtime_events_conversation_idx ON public.agent_runtime_events USING btree (conversation_id, created_at DESC);

CREATE INDEX agent_suggestions_workspace_status_idx ON public.agent_suggestions USING btree (workspace_id, status, created_at DESC);

CREATE INDEX idx_conversations_status ON public.conversations USING btree (status);

CREATE INDEX idx_conversation_states_conversation_id ON public.conversation_states USING btree (conversation_id);

CREATE INDEX agent_versions_compiler_idx ON public.agent_versions USING btree (agent_id, compiler_version, created_at DESC);

CREATE INDEX idx_pipeline_stages_is_active ON public.pipeline_stages USING btree (is_active);

CREATE INDEX idx_message_grouping_queue_processed ON public.message_grouping_queue USING btree (processed);

CREATE INDEX workspace_members_user_idx ON public.workspace_members USING btree (user_id, status);

CREATE INDEX idx_message_grouping_queue_message_id ON public.message_grouping_queue USING btree (message_id);

CREATE UNIQUE INDEX idx_contacts_instagram_user_id ON public.contacts USING btree (instagram_user_id) WHERE (instagram_user_id IS NOT NULL);

CREATE INDEX idx_golden_cases_active ON public.golden_cases USING btree (created_at) WHERE is_active;

CREATE INDEX idx_send_queue_status ON public.send_queue USING btree (status);

CREATE INDEX idx_nina_processing_queue_scheduled_for ON public.nina_processing_queue USING btree (scheduled_for);

CREATE INDEX idx_contacts_whatsapp_id ON public.contacts USING btree (whatsapp_id);

CREATE INDEX eval_results_workspace_run_idx ON public.eval_results USING btree (workspace_id, run_id, result_status);

CREATE INDEX idx_conversations_contact_id ON public.conversations USING btree (contact_id);

CREATE INDEX idx_send_queue_contact_id ON public.send_queue USING btree (contact_id);

CREATE UNIQUE INDEX knowledge_documents_workspace_fingerprint_unique ON public.knowledge_documents USING btree (workspace_id, fingerprint) WHERE (fingerprint IS NOT NULL);

CREATE INDEX idx_send_queue_priority ON public.send_queue USING btree (priority DESC);

CREATE INDEX idx_messages_status ON public.messages USING btree (status);

CREATE INDEX agent_runtime_events_workspace_created_idx ON public.agent_runtime_events USING btree (workspace_id, created_at DESC);

CREATE INDEX agent_versions_agent_created_idx ON public.agent_versions USING btree (agent_id, created_at DESC);

CREATE INDEX idx_tag_definitions_category ON public.tag_definitions USING btree (category);

CREATE INDEX idx_contacts_tags ON public.contacts USING gin (tags);

CREATE INDEX idx_tag_definitions_key ON public.tag_definitions USING btree (key);

CREATE INDEX idx_messages_sent_at ON public.messages USING btree (sent_at DESC);

CREATE INDEX idx_pipeline_stages_position ON public.pipeline_stages USING btree ("position");

CREATE TRIGGER message_processing_queue_updated_at BEFORE UPDATE ON public.message_processing_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.message_processing_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_message_processing_queue_updated_at BEFORE UPDATE ON public.message_processing_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER send_queue_updated_at BEFORE UPDATE ON public.send_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.send_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_send_queue_updated_at BEFORE UPDATE ON public.send_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER agent_versions_are_immutable BEFORE DELETE OR UPDATE ON public.agent_versions FOR EACH ROW EXECUTE FUNCTION prevent_immutable_agent_record_mutation();

CREATE TRIGGER update_agent_drafts_updated_at BEFORE UPDATE ON public.agent_drafts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER enforce_knowledge_ingestion_rate_limit_before_insert BEFORE INSERT ON public.knowledge_documents FOR EACH ROW EXECUTE FUNCTION enforce_knowledge_ingestion_rate_limit();

CREATE TRIGGER update_knowledge_documents_updated_at BEFORE UPDATE ON public.knowledge_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_calendar_integrations_updated_at BEFORE UPDATE ON public.calendar_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_channel_connections_updated_at BEFORE UPDATE ON public.channel_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deal_activities_updated_at BEFORE UPDATE ON public.deal_activities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_golden_cases_updated_at BEFORE UPDATE ON public.golden_cases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER nina_settings_updated_at BEFORE UPDATE ON public.nina_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.nina_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nina_settings_updated_at BEFORE UPDATE ON public.nina_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_team_functions_updated_at BEFORE UPDATE ON public.team_functions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.nina_processing_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nina_processing_queue_updated_at BEFORE UPDATE ON public.nina_processing_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER conversation_states_updated_at BEFORE UPDATE ON public.conversation_states FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversation_states FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversation_states_updated_at BEFORE UPDATE ON public.conversation_states FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_suggestions_updated_at BEFORE UPDATE ON public.agent_suggestions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER agent_audit_log_is_immutable BEFORE DELETE OR UPDATE ON public.agent_audit_log FOR EACH ROW EXECUTE FUNCTION prevent_immutable_agent_record_mutation();

CREATE TRIGGER agent_runtime_events_are_immutable BEFORE DELETE OR UPDATE ON public.agent_runtime_events FOR EACH ROW EXECUTE FUNCTION prevent_immutable_agent_record_mutation();

CREATE TRIGGER assign_appointment_workspace_before_write BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION assign_appointment_workspace();

CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER auto_create_deal_on_contact AFTER INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION auto_create_deal_on_contact();

CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversation_last_message_trigger AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message_trigger();

CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER normalize_knowledge_fact_before_write BEFORE INSERT OR UPDATE ON public.knowledge_facts FOR EACH ROW EXECUTE FUNCTION normalize_knowledge_fact();

CREATE TRIGGER update_knowledge_facts_updated_at BEFORE UPDATE ON public.knowledge_facts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pipeline_stages_updated_at BEFORE UPDATE ON public.pipeline_stages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tag_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tag_definitions_updated_at BEFORE UPDATE ON public.tag_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tag_definitions_updated_at BEFORE UPDATE ON public.tag_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_team_members_updated_at BEFORE UPDATE ON public.team_members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER audit_workspace_membership_changes AFTER INSERT OR DELETE OR UPDATE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION audit_workspace_membership_change();

CREATE TRIGGER update_workspace_members_updated_at BEFORE UPDATE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

alter table public.deal_activities enable row level security;

alter table public.workspaces enable row level security;

alter table public.agent_drafts enable row level security;

alter table public.agent_suggestions enable row level security;

alter table public.calendar_integrations enable row level security;

alter table public.agent_operation_rate_limits enable row level security;

alter table public.knowledge_chunks enable row level security;

alter table public.team_members enable row level security;

alter table public.user_roles enable row level security;

alter table public.agent_versions enable row level security;

alter table public.send_queue enable row level security;

alter table public.message_processing_queue enable row level security;

alter table public.nina_processing_queue enable row level security;

alter table public.conversation_states enable row level security;

alter table public.agents enable row level security;

alter table public.calendar_oauth_states enable row level security;

alter table public.agent_audit_log enable row level security;

alter table public.knowledge_documents enable row level security;

alter table public.agent_runtime_events enable row level security;

alter table public.agent_action_runs enable row level security;

alter table public.unanswered_questions enable row level security;

alter table public.channel_connections enable row level security;

alter table public.contacts enable row level security;

alter table public.eval_results enable row level security;

alter table public.appointments enable row level security;

alter table public.deals enable row level security;

alter table public.message_grouping_queue enable row level security;

alter table public.profiles enable row level security;

alter table public.knowledge_facts enable row level security;

alter table public.eval_runs enable row level security;

alter table public.golden_cases enable row level security;

alter table public.pipeline_stages enable row level security;

alter table public.conversations enable row level security;

alter table public.messages enable row level security;

alter table public.nina_settings enable row level security;

alter table public.team_functions enable row level security;

alter table public.prompt_versions enable row level security;

alter table public.tag_definitions enable row level security;

alter table public.workspace_members enable row level security;

alter table public.zernio_webhook_events enable row level security;

alter table public.teams enable row level security;

create policy "Admins can manage all roles" on public.user_roles as PERMISSIVE for ALL to public using (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can manage channel connections" on public.channel_connections as PERMISSIVE for ALL to authenticated using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can manage nina_settings" on public.nina_settings as PERMISSIVE for ALL to authenticated using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can manage unanswered questions" on public.unanswered_questions as PERMISSIVE for ALL to authenticated using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can modify pipeline_stages" on public.pipeline_stages as PERMISSIVE for ALL to authenticated using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can modify tag_definitions" on public.tag_definitions as PERMISSIVE for ALL to authenticated using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can modify team_functions" on public.team_functions as PERMISSIVE for ALL to authenticated using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can modify team_members" on public.team_members as PERMISSIVE for ALL to authenticated using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Authenticated users can access all contacts" on public.contacts as PERMISSIVE for ALL to public using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));

create policy "Authenticated can read pipeline_stages" on public.pipeline_stages as PERMISSIVE for SELECT to authenticated using (true);

create policy "Authenticated can read teams" on public.teams as PERMISSIVE for SELECT to authenticated using (true);

create policy "Members can read agent drafts" on public.agent_drafts as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy "Members can read workspace memberships" on public.workspace_members as PERMISSIVE for SELECT to authenticated using (((user_id = auth.uid()) OR is_workspace_admin(workspace_id)));

create policy "Admins can modify teams" on public.teams as PERMISSIVE for ALL to authenticated using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Authenticated can read tag_definitions" on public.tag_definitions as PERMISSIVE for SELECT to authenticated using (true);

create policy "Authenticated can read team_members" on public.team_members as PERMISSIVE for SELECT to authenticated using (true);

create policy "Authenticated users can access all conversations" on public.conversations as PERMISSIVE for ALL to public using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));

create policy "Members can read agent versions" on public.agent_versions as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy "Workspace admins can update their workspace" on public.workspaces as PERMISSIVE for UPDATE to authenticated using (is_workspace_admin(id)) with check (is_workspace_admin(id));

create policy "Admins can read zernio webhook events" on public.zernio_webhook_events as PERMISSIVE for SELECT to authenticated using (has_role(auth.uid(), 'admin'::app_role));

create policy "Authenticated can read channel connections" on public.channel_connections as PERMISSIVE for SELECT to authenticated using (true);

create policy "Authenticated can read team_functions" on public.team_functions as PERMISSIVE for SELECT to authenticated using (true);

create policy "Authenticated users can access all messages" on public.messages as PERMISSIVE for ALL to public using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));

create policy "Members can read agents" on public.agents as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy "Users can access states of their conversations" on public.conversation_states as PERMISSIVE for ALL to public using ((EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = conversation_states.conversation_id) AND (conversations.user_id = auth.uid()))))) with check ((EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = conversation_states.conversation_id) AND (conversations.user_id = auth.uid())))));

create policy "Admins podem apagar versoes de prompt" on public.prompt_versions as PERMISSIVE for DELETE to authenticated using (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins podem criar versoes de prompt" on public.prompt_versions as PERMISSIVE for INSERT to authenticated with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Autenticados podem ler o historico de prompts" on public.prompt_versions as PERMISSIVE for SELECT to authenticated using (true);

create policy "Members can read agent audit" on public.agent_audit_log as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy "Members can read their workspaces" on public.workspaces as PERMISSIVE for SELECT to authenticated using (is_workspace_member(id));

create policy "Users can insert own profile" on public.profiles as PERMISSIVE for INSERT to public with check ((auth.uid() = user_id));

create policy "Users can update own profile" on public.profiles as PERMISSIVE for UPDATE to public using ((auth.uid() = user_id));

create policy evaluation_results_workspace_read on public.eval_results as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy "Users can access activities of their deals" on public.deal_activities as PERMISSIVE for ALL to public using ((EXISTS ( SELECT 1
   FROM deals
  WHERE ((deals.id = deal_activities.deal_id) AND (deals.user_id = auth.uid()))))) with check ((EXISTS ( SELECT 1
   FROM deals
  WHERE ((deals.id = deal_activities.deal_id) AND (deals.user_id = auth.uid())))));

create policy "Workspace admins can manage memberships" on public.workspace_members as PERMISSIVE for ALL to authenticated using (is_workspace_admin(workspace_id)) with check (is_workspace_admin(workspace_id));

create policy "Users can view own roles" on public.user_roles as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));

create policy agent_runtime_events_workspace_read on public.agent_runtime_events as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy evaluation_scenarios_workspace_read on public.golden_cases as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy evaluation_scenarios_workspace_write on public.golden_cases as PERMISSIVE for ALL to authenticated using (can_edit_agent(workspace_id)) with check (can_edit_agent(workspace_id));

create policy unanswered_workspace_read on public.unanswered_questions as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy unanswered_workspace_write on public.unanswered_questions as PERMISSIVE for ALL to authenticated using (can_edit_agent(workspace_id)) with check (can_edit_agent(workspace_id));

create policy agent_suggestions_workspace_read on public.agent_suggestions as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy knowledge_chunks_workspace_read on public.knowledge_chunks as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy knowledge_chunks_workspace_write on public.knowledge_chunks as PERMISSIVE for ALL to authenticated using (can_edit_agent(workspace_id)) with check (can_edit_agent(workspace_id));

create policy "Authenticated users can access all appointments" on public.appointments as PERMISSIVE for ALL to authenticated using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));

create policy knowledge_documents_workspace_write on public.knowledge_documents as PERMISSIVE for ALL to authenticated using (can_edit_agent(workspace_id)) with check (can_edit_agent(workspace_id));

create policy knowledge_documents_workspace_read on public.knowledge_documents as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy "Users can view own profile" on public.profiles as PERMISSIVE for SELECT to public using ((auth.uid() = user_id));

create policy agent_action_runs_workspace_read on public.agent_action_runs as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy evaluation_runs_workspace_read on public.eval_runs as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy knowledge_facts_workspace_read on public.knowledge_facts as PERMISSIVE for SELECT to authenticated using (is_workspace_member(workspace_id));

create policy knowledge_facts_workspace_write on public.knowledge_facts as PERMISSIVE for ALL to authenticated using (can_edit_agent(workspace_id)) with check (can_edit_agent(workspace_id));

create policy "Authenticated users can access all deals" on public.deals as PERMISSIVE for ALL to authenticated using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));

create policy "Service role insert for audio" on storage.objects as PERMISSIVE for INSERT to service_role with check ((bucket_id = 'audio-messages'::text));

revoke all on table public.deal_activities from anon, authenticated;

revoke all on table public.workspaces from anon, authenticated;

revoke all on table public.agent_drafts from anon, authenticated;

revoke all on table public.agent_suggestions from anon, authenticated;

revoke all on table public.calendar_integrations from anon, authenticated;

revoke all on table public.agent_operation_rate_limits from anon, authenticated;

revoke all on table public.knowledge_chunks from anon, authenticated;

revoke all on table public.team_members from anon, authenticated;

revoke all on table public.user_roles from anon, authenticated;

revoke all on table public.agent_versions from anon, authenticated;

revoke all on table public.send_queue from anon, authenticated;

revoke all on table public.message_processing_queue from anon, authenticated;

revoke all on table public.nina_processing_queue from anon, authenticated;

revoke all on table public.conversation_states from anon, authenticated;

revoke all on table public.agents from anon, authenticated;

revoke all on table public.calendar_oauth_states from anon, authenticated;

revoke all on table public.agent_audit_log from anon, authenticated;

revoke all on table public.knowledge_documents from anon, authenticated;

revoke all on table public.agent_runtime_events from anon, authenticated;

revoke all on table public.agent_action_runs from anon, authenticated;

revoke all on table public.unanswered_questions from anon, authenticated;

revoke all on table public.channel_connections from anon, authenticated;

revoke all on table public.contacts from anon, authenticated;

revoke all on table public.eval_results from anon, authenticated;

revoke all on table public.appointments from anon, authenticated;

revoke all on table public.deals from anon, authenticated;

revoke all on table public.message_grouping_queue from anon, authenticated;

revoke all on table public.profiles from anon, authenticated;

revoke all on table public.knowledge_facts from anon, authenticated;

revoke all on table public.eval_runs from anon, authenticated;

revoke all on table public.golden_cases from anon, authenticated;

revoke all on table public.pipeline_stages from anon, authenticated;

revoke all on table public.conversations from anon, authenticated;

revoke all on table public.messages from anon, authenticated;

revoke all on table public.nina_settings from anon, authenticated;

revoke all on table public.team_functions from anon, authenticated;

revoke all on table public.prompt_versions from anon, authenticated;

revoke all on table public.tag_definitions from anon, authenticated;

revoke all on table public.workspace_members from anon, authenticated;

revoke all on table public.zernio_webhook_events from anon, authenticated;

revoke all on table public.teams from anon, authenticated;

revoke all on table public.contacts_with_stats from anon, authenticated;

revoke all on table public.nina_settings_public from anon, authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_action_runs to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_action_runs to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_action_runs to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_audit_log to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_audit_log to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_audit_log to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_drafts to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_drafts to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_drafts to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_operation_rate_limits to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_operation_rate_limits to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_operation_rate_limits to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_runtime_events to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_runtime_events to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_runtime_events to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_suggestions to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_suggestions to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_suggestions to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_versions to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_versions to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agent_versions to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agents to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agents to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agents to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.appointments to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.appointments to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.appointments to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.calendar_integrations to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.calendar_integrations to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.calendar_integrations to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.calendar_oauth_states to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.calendar_oauth_states to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.calendar_oauth_states to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.channel_connections to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.channel_connections to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.channel_connections to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.contacts to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.contacts to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.contacts to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.contacts_with_stats to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.contacts_with_stats to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.contacts_with_stats to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.conversation_states to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.conversation_states to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.conversation_states to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.conversations to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.conversations to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.conversations to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.deal_activities to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.deal_activities to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.deal_activities to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.deals to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.deals to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.deals to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.eval_results to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.eval_results to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.eval_results to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.eval_runs to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.eval_runs to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.eval_runs to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.golden_cases to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.golden_cases to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.golden_cases to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.knowledge_chunks to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.knowledge_chunks to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.knowledge_chunks to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.knowledge_documents to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.knowledge_documents to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.knowledge_documents to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.knowledge_facts to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.knowledge_facts to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.knowledge_facts to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.message_grouping_queue to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.message_grouping_queue to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.message_grouping_queue to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.message_processing_queue to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.message_processing_queue to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.message_processing_queue to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.messages to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.messages to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.messages to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.nina_processing_queue to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.nina_processing_queue to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.nina_processing_queue to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.nina_settings to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.nina_settings to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.nina_settings to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.nina_settings_public to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.nina_settings_public to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.nina_settings_public to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.pipeline_stages to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.pipeline_stages to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.pipeline_stages to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.profiles to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.profiles to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.profiles to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.prompt_versions to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.prompt_versions to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.prompt_versions to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.send_queue to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.send_queue to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.send_queue to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.tag_definitions to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.tag_definitions to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.tag_definitions to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.team_functions to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.team_functions to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.team_functions to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.team_members to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.team_members to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.team_members to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.teams to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.teams to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.teams to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.unanswered_questions to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.unanswered_questions to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.unanswered_questions to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.user_roles to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.user_roles to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.user_roles to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.workspace_members to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.workspace_members to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.workspace_members to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.workspaces to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.workspaces to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.workspaces to service_role;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.zernio_webhook_events to anon;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.zernio_webhook_events to authenticated;

grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.zernio_webhook_events to service_role;

revoke all on function normalize_knowledge_fact() from public, anon, authenticated;

revoke all on function enforce_knowledge_ingestion_rate_limit() from public, anon, authenticated;

revoke all on function prevent_immutable_agent_record_mutation() from public, anon, authenticated;

revoke all on function review_agent_suggestion(uuid,text,text,uuid) from public, anon, authenticated;

revoke all on function audit_workspace_membership_change() from public, anon, authenticated;

revoke all on function update_conversation_last_message_trigger() from public, anon, authenticated;

revoke all on function can_edit_agent(uuid,uuid) from public, anon, authenticated;

revoke all on function write_knowledge_document(uuid,text,text,text,text,text,text,boolean,jsonb,text,text[]) from public, anon, authenticated;

revoke all on function assign_appointment_workspace() from public, anon, authenticated;

revoke all on function update_client_memory(uuid,jsonb) from public, anon, authenticated;

revoke all on function can_publish_agent(uuid,uuid) from public, anon, authenticated;

revoke all on function create_deal_for_new_contact() from public, anon, authenticated;

revoke all on function bootstrap_agent_workspace(text,jsonb) from public, anon, authenticated;

revoke all on function get_auth_user_id() from public, anon, authenticated;

revoke all on function claim_message_processing_batch(integer) from public, anon, authenticated;

revoke all on function cleanup_processed_message_queue() from public, anon, authenticated;

revoke all on function handle_new_user() from public, anon, authenticated;

revoke all on function claim_send_queue_batch(integer) from public, anon, authenticated;

revoke all on function ensure_edge_secrets(text,text) from public, anon, authenticated;

revoke all on function search_knowledge(text,integer) from public, anon, authenticated;

revoke all on function get_current_agent_context() from public, anon, authenticated;

revoke all on function update_conversation_state(uuid,text,text,jsonb) from public, anon, authenticated;

revoke all on function bootstrap_current_user(text) from public, anon, authenticated;

revoke all on function search_workspace_knowledge(uuid,text,integer) from public, anon, authenticated;

revoke all on function auto_create_deal_on_contact() from public, anon, authenticated;

revoke all on function review_evaluation_result(uuid,text,boolean) from public, anon, authenticated;

revoke all on function is_workspace_admin(uuid,uuid) from public, anon, authenticated;

revoke all on function is_workspace_member(uuid,uuid) from public, anon, authenticated;

revoke all on function update_conversation_last_message() from public, anon, authenticated;

revoke all on function claim_nina_processing_batch(integer) from public, anon, authenticated;

revoke all on function enqueue_nina_processing(uuid,uuid,uuid,integer,jsonb) from public, anon, authenticated;

revoke all on function save_agent_draft(uuid,jsonb,integer) from public, anon, authenticated;

revoke all on function current_workspace_id() from public, anon, authenticated;

revoke all on function record_agent_product_event(uuid,text,text,jsonb) from public, anon, authenticated;

revoke all on function get_or_create_conversation_state(uuid) from public, anon, authenticated;

revoke all on function publish_compiled_agent_draft(uuid,integer,text,text,uuid,uuid,text,jsonb) from public, anon, authenticated;

revoke all on function consume_agent_rate_limit(uuid,text,text,integer,integer) from public, anon, authenticated;

revoke all on function update_updated_at_column() from public, anon, authenticated;

revoke all on function has_role(uuid,app_role) from public, anon, authenticated;

revoke all on function restore_agent_version_to_draft(uuid,uuid,integer) from public, anon, authenticated;

revoke all on function cleanup_processed_queues() from public, anon, authenticated;

revoke all on function publish_agent_draft(uuid,integer,uuid,text,jsonb) from public, anon, authenticated;

grant execute on function normalize_knowledge_fact() to public;

grant execute on function normalize_knowledge_fact() to anon;

grant execute on function normalize_knowledge_fact() to authenticated;

grant execute on function normalize_knowledge_fact() to service_role;

grant execute on function enforce_knowledge_ingestion_rate_limit() to public;

grant execute on function enforce_knowledge_ingestion_rate_limit() to anon;

grant execute on function enforce_knowledge_ingestion_rate_limit() to authenticated;

grant execute on function enforce_knowledge_ingestion_rate_limit() to service_role;

grant execute on function prevent_immutable_agent_record_mutation() to public;

grant execute on function prevent_immutable_agent_record_mutation() to anon;

grant execute on function prevent_immutable_agent_record_mutation() to authenticated;

grant execute on function prevent_immutable_agent_record_mutation() to service_role;

grant execute on function review_agent_suggestion(uuid,text,text,uuid) to public;

grant execute on function review_agent_suggestion(uuid,text,text,uuid) to anon;

grant execute on function review_agent_suggestion(uuid,text,text,uuid) to authenticated;

grant execute on function review_agent_suggestion(uuid,text,text,uuid) to service_role;

grant execute on function audit_workspace_membership_change() to public;

grant execute on function audit_workspace_membership_change() to anon;

grant execute on function audit_workspace_membership_change() to authenticated;

grant execute on function audit_workspace_membership_change() to service_role;

grant execute on function update_conversation_last_message_trigger() to public;

grant execute on function update_conversation_last_message_trigger() to anon;

grant execute on function update_conversation_last_message_trigger() to authenticated;

grant execute on function update_conversation_last_message_trigger() to service_role;

grant execute on function can_edit_agent(uuid,uuid) to public;

grant execute on function can_edit_agent(uuid,uuid) to anon;

grant execute on function can_edit_agent(uuid,uuid) to authenticated;

grant execute on function can_edit_agent(uuid,uuid) to service_role;

grant execute on function write_knowledge_document(uuid,text,text,text,text,text,text,boolean,jsonb,text,text[]) to public;

grant execute on function write_knowledge_document(uuid,text,text,text,text,text,text,boolean,jsonb,text,text[]) to anon;

grant execute on function write_knowledge_document(uuid,text,text,text,text,text,text,boolean,jsonb,text,text[]) to authenticated;

grant execute on function write_knowledge_document(uuid,text,text,text,text,text,text,boolean,jsonb,text,text[]) to service_role;

grant execute on function assign_appointment_workspace() to public;

grant execute on function assign_appointment_workspace() to anon;

grant execute on function assign_appointment_workspace() to authenticated;

grant execute on function assign_appointment_workspace() to service_role;

grant execute on function update_client_memory(uuid,jsonb) to public;

grant execute on function update_client_memory(uuid,jsonb) to anon;

grant execute on function update_client_memory(uuid,jsonb) to authenticated;

grant execute on function update_client_memory(uuid,jsonb) to service_role;

grant execute on function can_publish_agent(uuid,uuid) to public;

grant execute on function can_publish_agent(uuid,uuid) to anon;

grant execute on function can_publish_agent(uuid,uuid) to authenticated;

grant execute on function can_publish_agent(uuid,uuid) to service_role;

grant execute on function create_deal_for_new_contact() to public;

grant execute on function create_deal_for_new_contact() to anon;

grant execute on function create_deal_for_new_contact() to authenticated;

grant execute on function create_deal_for_new_contact() to service_role;

grant execute on function bootstrap_agent_workspace(text,jsonb) to public;

grant execute on function bootstrap_agent_workspace(text,jsonb) to anon;

grant execute on function bootstrap_agent_workspace(text,jsonb) to authenticated;

grant execute on function bootstrap_agent_workspace(text,jsonb) to service_role;

grant execute on function get_auth_user_id() to public;

grant execute on function get_auth_user_id() to anon;

grant execute on function get_auth_user_id() to authenticated;

grant execute on function get_auth_user_id() to service_role;

grant execute on function claim_message_processing_batch(integer) to public;

grant execute on function claim_message_processing_batch(integer) to anon;

grant execute on function claim_message_processing_batch(integer) to authenticated;

grant execute on function claim_message_processing_batch(integer) to service_role;

grant execute on function cleanup_processed_message_queue() to public;

grant execute on function cleanup_processed_message_queue() to anon;

grant execute on function cleanup_processed_message_queue() to authenticated;

grant execute on function cleanup_processed_message_queue() to service_role;

grant execute on function handle_new_user() to public;

grant execute on function handle_new_user() to anon;

grant execute on function handle_new_user() to authenticated;

grant execute on function handle_new_user() to service_role;

grant execute on function claim_send_queue_batch(integer) to public;

grant execute on function claim_send_queue_batch(integer) to anon;

grant execute on function claim_send_queue_batch(integer) to authenticated;

grant execute on function claim_send_queue_batch(integer) to service_role;

grant execute on function ensure_edge_secrets(text,text) to public;

grant execute on function ensure_edge_secrets(text,text) to anon;

grant execute on function ensure_edge_secrets(text,text) to authenticated;

grant execute on function ensure_edge_secrets(text,text) to service_role;

grant execute on function search_knowledge(text,integer) to public;

grant execute on function search_knowledge(text,integer) to anon;

grant execute on function search_knowledge(text,integer) to authenticated;

grant execute on function search_knowledge(text,integer) to service_role;

grant execute on function get_current_agent_context() to public;

grant execute on function get_current_agent_context() to anon;

grant execute on function get_current_agent_context() to authenticated;

grant execute on function get_current_agent_context() to service_role;

grant execute on function update_conversation_state(uuid,text,text,jsonb) to public;

grant execute on function update_conversation_state(uuid,text,text,jsonb) to anon;

grant execute on function update_conversation_state(uuid,text,text,jsonb) to authenticated;

grant execute on function update_conversation_state(uuid,text,text,jsonb) to service_role;

grant execute on function bootstrap_current_user(text) to public;

grant execute on function bootstrap_current_user(text) to anon;

grant execute on function bootstrap_current_user(text) to authenticated;

grant execute on function bootstrap_current_user(text) to service_role;

grant execute on function search_workspace_knowledge(uuid,text,integer) to public;

grant execute on function search_workspace_knowledge(uuid,text,integer) to anon;

grant execute on function search_workspace_knowledge(uuid,text,integer) to authenticated;

grant execute on function search_workspace_knowledge(uuid,text,integer) to service_role;

grant execute on function auto_create_deal_on_contact() to public;

grant execute on function auto_create_deal_on_contact() to anon;

grant execute on function auto_create_deal_on_contact() to authenticated;

grant execute on function auto_create_deal_on_contact() to service_role;

grant execute on function review_evaluation_result(uuid,text,boolean) to public;

grant execute on function review_evaluation_result(uuid,text,boolean) to anon;

grant execute on function review_evaluation_result(uuid,text,boolean) to authenticated;

grant execute on function review_evaluation_result(uuid,text,boolean) to service_role;

grant execute on function is_workspace_admin(uuid,uuid) to public;

grant execute on function is_workspace_admin(uuid,uuid) to anon;

grant execute on function is_workspace_admin(uuid,uuid) to authenticated;

grant execute on function is_workspace_admin(uuid,uuid) to service_role;

grant execute on function is_workspace_member(uuid,uuid) to public;

grant execute on function is_workspace_member(uuid,uuid) to anon;

grant execute on function is_workspace_member(uuid,uuid) to authenticated;

grant execute on function is_workspace_member(uuid,uuid) to service_role;

grant execute on function update_conversation_last_message() to public;

grant execute on function update_conversation_last_message() to anon;

grant execute on function update_conversation_last_message() to authenticated;

grant execute on function update_conversation_last_message() to service_role;

grant execute on function claim_nina_processing_batch(integer) to public;

grant execute on function claim_nina_processing_batch(integer) to anon;

grant execute on function claim_nina_processing_batch(integer) to authenticated;

grant execute on function claim_nina_processing_batch(integer) to service_role;

grant execute on function enqueue_nina_processing(uuid,uuid,uuid,integer,jsonb) to public;

grant execute on function enqueue_nina_processing(uuid,uuid,uuid,integer,jsonb) to anon;

grant execute on function enqueue_nina_processing(uuid,uuid,uuid,integer,jsonb) to authenticated;

grant execute on function enqueue_nina_processing(uuid,uuid,uuid,integer,jsonb) to service_role;

grant execute on function save_agent_draft(uuid,jsonb,integer) to public;

grant execute on function save_agent_draft(uuid,jsonb,integer) to anon;

grant execute on function save_agent_draft(uuid,jsonb,integer) to authenticated;

grant execute on function save_agent_draft(uuid,jsonb,integer) to service_role;

grant execute on function current_workspace_id() to public;

grant execute on function current_workspace_id() to anon;

grant execute on function current_workspace_id() to authenticated;

grant execute on function current_workspace_id() to service_role;

grant execute on function record_agent_product_event(uuid,text,text,jsonb) to public;

grant execute on function record_agent_product_event(uuid,text,text,jsonb) to anon;

grant execute on function record_agent_product_event(uuid,text,text,jsonb) to authenticated;

grant execute on function record_agent_product_event(uuid,text,text,jsonb) to service_role;

grant execute on function get_or_create_conversation_state(uuid) to public;

grant execute on function get_or_create_conversation_state(uuid) to anon;

grant execute on function get_or_create_conversation_state(uuid) to authenticated;

grant execute on function get_or_create_conversation_state(uuid) to service_role;

grant execute on function publish_compiled_agent_draft(uuid,integer,text,text,uuid,uuid,text,jsonb) to public;

grant execute on function publish_compiled_agent_draft(uuid,integer,text,text,uuid,uuid,text,jsonb) to anon;

grant execute on function publish_compiled_agent_draft(uuid,integer,text,text,uuid,uuid,text,jsonb) to authenticated;

grant execute on function publish_compiled_agent_draft(uuid,integer,text,text,uuid,uuid,text,jsonb) to service_role;

grant execute on function consume_agent_rate_limit(uuid,text,text,integer,integer) to public;

grant execute on function consume_agent_rate_limit(uuid,text,text,integer,integer) to anon;

grant execute on function consume_agent_rate_limit(uuid,text,text,integer,integer) to authenticated;

grant execute on function consume_agent_rate_limit(uuid,text,text,integer,integer) to service_role;

grant execute on function update_updated_at_column() to public;

grant execute on function update_updated_at_column() to anon;

grant execute on function update_updated_at_column() to authenticated;

grant execute on function update_updated_at_column() to service_role;

grant execute on function has_role(uuid,app_role) to public;

grant execute on function has_role(uuid,app_role) to anon;

grant execute on function has_role(uuid,app_role) to authenticated;

grant execute on function has_role(uuid,app_role) to service_role;

grant execute on function restore_agent_version_to_draft(uuid,uuid,integer) to public;

grant execute on function restore_agent_version_to_draft(uuid,uuid,integer) to anon;

grant execute on function restore_agent_version_to_draft(uuid,uuid,integer) to authenticated;

grant execute on function restore_agent_version_to_draft(uuid,uuid,integer) to service_role;

grant execute on function cleanup_processed_queues() to public;

grant execute on function cleanup_processed_queues() to anon;

grant execute on function cleanup_processed_queues() to authenticated;

grant execute on function cleanup_processed_queues() to service_role;

grant execute on function publish_agent_draft(uuid,integer,uuid,text,jsonb) to public;

grant execute on function publish_agent_draft(uuid,integer,uuid,text,jsonb) to anon;

grant execute on function publish_agent_draft(uuid,integer,uuid,text,jsonb) to authenticated;

grant execute on function publish_agent_draft(uuid,integer,uuid,text,jsonb) to service_role;

alter table public.team_members replica identity full;

alter table public.channel_connections replica identity full;

alter table public.contacts replica identity full;

alter table public.appointments replica identity full;

alter table public.deals replica identity full;

alter table public.pipeline_stages replica identity full;

alter table public.conversations replica identity full;

alter table public.messages replica identity full;

alter table public.team_functions replica identity full;

alter table public.teams replica identity full;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('chat-media', 'chat-media', false, null, null) on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('audio-messages', 'audio-messages', false, null, null) on conflict (id) do nothing;



