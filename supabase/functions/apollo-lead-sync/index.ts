import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getUserFromToken } from '../_shared/auth.ts';
import { ApolloError, extractPhone, matchPerson, scoreLead, searchPeople } from '../_shared/apollo.ts';
import { upsertUnifiedContact } from '../_shared/lead-identity.ts';

/**
 * Captação semanal de leads na Apollo.
 * Busca -> descarta repetidos -> enriquece -> grava lead -> cria contato no CRM
 * -> monta a campanha de disparo da semana com o template aprovado configurado.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_EXECUTION_MS = 110_000;
const MAX_PAGES = 12;
const PER_PAGE = 25;
const LOCK_SECONDS = 600;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Método não permitido' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const service = createClient(supabaseUrl, serviceKey);
  const startedAt = Date.now();

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const internal = token === serviceKey;
  let triggerSource = 'cron';

  if (!internal) {
    if (!token) return json(401, { error: 'Unauthorized' });
    const { data: userData, error: userError } = await getUserFromToken(token);
    if (userError || !userData.user) return json(401, { error: 'Unauthorized' });
    const { data: adminRole } = await service
      .from('user_roles').select('role').eq('user_id', userData.user.id).eq('role', 'admin').maybeSingle();
    if (!adminRole) {
      const { data: membership } = await service
        .from('workspace_members').select('role').eq('user_id', userData.user.id).eq('status', 'active');
      const rows = (membership ?? []) as Array<{ role: string }>;
      if (!rows.some((row) => row.role === 'admin' || row.role === 'editor')) {
        return json(403, { error: 'Sem permissão para buscar leads.', code: 'not_allowed' });
      }
    }
    triggerSource = 'manual';
  }

  let runId: string | null = null;

  try {
    // Configuração (cria a linha padrão na primeira execução)
    let { data: settings } = await service.from('apollo_search_settings').select('*').limit(1).maybeSingle();
    if (!settings) {
      const { data: created, error } = await service
        .from('apollo_search_settings').insert({}).select('*').single();
      if (error) throw error;
      settings = created;
    }
    if (settings.paused) {
      return json(409, { error: settings.paused_reason || 'Captação pausada.', code: 'paused' });
    }

    // Trava de execução única
    const { data: running } = await service
      .from('apollo_search_runs')
      .select('id, locked_until')
      .eq('status', 'running')
      .gt('locked_until', new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (running) return json(409, { error: 'Já existe uma busca em andamento.', code: 'locked' });

    const quota = Math.max(1, Math.min(500, Number(settings.weekly_quota ?? 80)));
    const { data: runRow, error: runError } = await service
      .from('apollo_search_runs')
      .insert({
        status: 'running',
        trigger_source: triggerSource,
        requested: quota,
        locked_until: new Date(Date.now() + LOCK_SECONDS * 1000).toISOString(),
      })
      .select('id')
      .single();
    if (runError) throw runError;
    runId = (runRow as { id: string }).id;

    const criteria = {
      titles: settings.titles ?? [],
      locations: settings.states ?? [],
      industries: settings.industries ?? [],
      employeesMin: Number(settings.employees_min ?? 50),
      employeesMax: Number(settings.employees_max ?? 500),
    };

    // 1) Busca paginada, guardando só IDs inéditos
    const newIds: string[] = [];
    let fetched = 0;
    for (let page = 1; page <= MAX_PAGES && newIds.length < quota; page += 1) {
      const { people } = await searchPeople(criteria, page, PER_PAGE);
      if (people.length === 0) break;
      fetched += people.length;
      const ids = people.map((person) => String(person.id)).filter(Boolean);
      const { data: known } = await service
        .from('apollo_leads').select('apollo_person_id').in('apollo_person_id', ids);
      const knownSet = new Set((known ?? []).map((row) => row.apollo_person_id as string));
      for (const id of ids) {
        if (!knownSet.has(id) && !newIds.includes(id) && newIds.length < quota) newIds.push(id);
      }
      if (Date.now() - startedAt > MAX_EXECUTION_MS) break;
    }

    // 2) Enriquecimento
    const webhookBase = `${supabaseUrl}/functions/v1/apollo-phone-webhook?token=${settings.webhook_token ?? ''}`;
    const insertedLeads: Array<{ id: string; contact_id: string | null; phone: string | null }> = [];
    let withPhone = 0;

    for (const apolloId of newIds) {
      if (Date.now() - startedAt > MAX_EXECUTION_MS) break;
      let person: Record<string, unknown> | null = null;
      try {
        person = await matchPerson(apolloId);
      } catch (error) {
        if (error instanceof ApolloError && error.terminal) throw error;
        continue;
      }
      if (!person) continue;

      // deno-lint-ignore no-explicit-any
      const p = person as any;
      const phone = extractPhone(p);
      const { score, reasons } = scoreLead(p, phone);
      const organization = p.organization ?? {};

      const { data: lead, error: leadError } = await service
        .from('apollo_leads')
        .insert({
          apollo_person_id: apolloId,
          full_name: p.name ?? null,
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          title: p.title ?? null,
          seniority: p.seniority ?? null,
          email: p.email ?? null,
          email_status: p.email_status ?? null,
          phone_number: phone,
          linkedin_url: p.linkedin_url ?? null,
          city: p.city ?? null,
          state: p.state ?? null,
          country: p.country ?? null,
          company_name: organization.name ?? p.organization_name ?? null,
          company_domain: organization.primary_domain ?? organization.website_url ?? null,
          company_industry: organization.industry ?? null,
          company_employees: organization.estimated_num_employees ?? null,
          company_city: organization.city ?? null,
          company_state: organization.state ?? null,
          priority_score: score,
          score_reasons: reasons,
          status: phone ? 'new' : 'no_phone',
          run_id: runId,
          raw: { person: p },
        })
        .select('id')
        .single();
      if (leadError) continue;
      const leadId = (lead as { id: string }).id;

      // Identidade unificada: toda pessoa capturada vira um contato ÚNICO no CRM,
      // com e-mail + telefone na mesma linha, persona e score — inclusive quando
      // não há telefone (o lead só-e-mail entra no CRM e aguarda o canal de
      // e-mail da cadência, em vez de ficar parado como antes).
      const contactId = await upsertUnifiedContact(service, {
        email: p.email ?? null,
        phone,
        fullName: p.name ?? null,
        firstName: p.first_name ?? null,
        title: p.title ?? null,
        seniority: p.seniority ?? null,
        companyName: organization.name ?? p.organization_name ?? null,
        companyDomain: organization.primary_domain ?? organization.website_url ?? null,
        companyIndustry: organization.industry ?? null,
        companyEmployees: organization.estimated_num_employees ?? null,
        linkedinUrl: p.linkedin_url ?? null,
        emailStatus: p.email_status ?? null,
        score,
        scoreReasons: reasons,
        apolloPersonId: apolloId,
        origin: 'apollo',
      });
      if (contactId) {
        await service.from('apollo_leads').update({ contact_id: contactId }).eq('id', leadId);
      }

      insertedLeads.push({ id: leadId, contact_id: contactId, phone });
      if (phone) withPhone += 1;

      // Sem celular: pede a revelação assíncrona à Apollo (resposta chega no webhook)
      if (!phone && settings.reveal_phones && settings.webhook_token) {
        try {
          await matchPerson(apolloId, webhookBase);
        } catch (error) {
          if (error instanceof ApolloError && error.terminal) throw error;
        }
      }
    }

    // 3) Leads com telefone ainda sem campanha (inclui os revelados pelo webhook)
    const { data: pending } = await service
      .from('apollo_leads')
      .select('id, full_name, first_name, phone_number, contact_id, company_name, email, email_status, title, seniority, company_domain, company_industry, company_employees, linkedin_url, priority_score, score_reasons, apollo_person_id')
      .not('phone_number', 'is', null)
      .is('campaign_id', null)
      .in('status', ['new', 'no_phone'])
      .order('priority_score', { ascending: false })
      .limit(quota);

    const readyLeads = (pending ?? []) as Array<{
      id: string; full_name: string | null; first_name: string | null;
      phone_number: string; contact_id: string | null; company_name: string | null;
      email: string | null; email_status: string | null; title: string | null;
      seniority: string | null; company_domain: string | null; company_industry: string | null;
      company_employees: number | null; linkedin_url: string | null;
      priority_score: number; score_reasons: unknown; apollo_person_id: string;
    }>;

    let campaignId: string | null = null;

    if (
      readyLeads.length > 0 && settings.auto_dispatch &&
      settings.template_name && settings.template_language
    ) {
      // Contatos no CRM
      const recipients: Array<{ leadId: string; contactId: string; phone: string; name: string | null }> = [];
      for (const lead of readyLeads) {
        let contactId = lead.contact_id;
        if (!contactId) {
          // Leads de execuções anteriores (telefone revelado depois pelo webhook)
          // que ainda não têm contato: unifica agora pelo mesmo caminho, com
          // e-mail, persona e score — não mais um contato só-telefone.
          contactId = await upsertUnifiedContact(service, {
            email: lead.email,
            phone: lead.phone_number,
            fullName: lead.full_name,
            firstName: lead.first_name,
            title: lead.title,
            seniority: lead.seniority,
            companyName: lead.company_name,
            companyDomain: lead.company_domain,
            companyIndustry: lead.company_industry,
            companyEmployees: lead.company_employees,
            linkedinUrl: lead.linkedin_url,
            emailStatus: lead.email_status,
            score: lead.priority_score,
            scoreReasons: lead.score_reasons,
            apolloPersonId: lead.apollo_person_id,
            origin: 'apollo',
          });
          if (!contactId) continue;
          await service.from('apollo_leads').update({ contact_id: contactId }).eq('id', lead.id);
        }
        recipients.push({ leadId: lead.id, contactId, phone: lead.phone_number, name: lead.full_name });
      }

      if (recipients.length > 0) {
        let pacing = {
          delay_min_s: 45, delay_max_s: 120, batch_size: 20,
          pause_between_batches_min: 10, pause_between_batches_max: 25,
        };
        if (settings.profile_id) {
          const { data: profile } = await service
            .from('dispatch_profiles').select('*').eq('id', settings.profile_id).maybeSingle();
          if (profile) {
            pacing = {
              delay_min_s: profile.delay_min_s,
              delay_max_s: profile.delay_max_s,
              batch_size: profile.batch_size,
              pause_between_batches_min: profile.pause_between_batches_min,
              pause_between_batches_max: profile.pause_between_batches_max,
            };
          }
        }

        const label = new Date().toLocaleDateString('pt-BR');
        const { data: campaign, error: campaignError } = await service
          .from('broadcast_campaigns')
          .insert({
            name: `Leads Apollo — ${label}`,
            template_name: settings.template_name,
            template_language: settings.template_language,
            template_body: settings.template_body ?? '',
            template_params: settings.template_params ?? [],
            profile_id: settings.profile_id,
            ...pacing,
            status: 'draft',
            total_recipients: recipients.length,
          })
          .select('id')
          .single();
        if (campaignError) throw campaignError;
        campaignId = (campaign as { id: string }).id;

        await service.from('broadcast_recipients').insert(
          recipients.map((item) => ({
            campaign_id: campaignId,
            contact_id: item.contactId,
            phone_number: item.phone,
            contact_name: item.name,
          })),
        );
        await service
          .from('apollo_leads')
          .update({ campaign_id: campaignId, status: 'queued' })
          .in('id', recipients.map((item) => item.leadId));

        // Dispara o motor de envio existente
        await fetch(`${supabaseUrl}/functions/v1/broadcast-processor`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaign_id: campaignId }),
        }).catch(() => undefined);
      }
    }

    await service.from('apollo_search_runs').update({
      status: 'success',
      fetched,
      new_leads: insertedLeads.length,
      with_phone: withPhone,
      campaign_id: campaignId,
      locked_until: null,
      finished_at: new Date().toISOString(),
    }).eq('id', runId);

    return json(200, {
      success: true,
      fetched,
      new_leads: insertedLeads.length,
      with_phone: withPhone,
      campaign_id: campaignId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('apollo-lead-sync falhou:', message);
    if (runId) {
      await service.from('apollo_search_runs').update({
        status: 'failed', error_message: message, locked_until: null, finished_at: new Date().toISOString(),
      }).eq('id', runId);
    }
    if (error instanceof ApolloError && error.terminal) {
      await service.from('apollo_search_settings').update({
        paused: true,
        paused_reason: `Apollo bloqueou as chamadas (${error.status}). Verifique créditos e permissões da chave.`,
      }).neq('id', '00000000-0000-0000-0000-000000000000');
      return json(error.status, { error: message, code: 'apollo_blocked' });
    }
    return json(500, { error: message });
  }
});
