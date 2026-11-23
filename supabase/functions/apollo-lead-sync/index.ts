import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getUserFromToken } from '../_shared/auth.ts';
import { ApolloError, extractPhone, matchPerson, scoreLead, searchPeople } from '../_shared/apollo.ts';
import { upsertUnifiedContact } from '../_shared/lead-identity.ts';
import { isExcludedDomain, isExcludedEmail } from '../_shared/exclusions.ts';
import { TAG_DOUBT, TAG_OUT, TAG_PENDING, triageBatch, type TriageLead } from '../_shared/lead-triage.ts';

/**
 * Captação semanal de leads na Apollo.
 * Busca -> descarta repetidos -> enriquece -> grava lead -> cria contato no CRM
 * -> triagem (Claude: OK / DÚVIDA / FORA; só OK entra na cadência)
 * -> monta a campanha de disparo da semana com o template aprovado configurado.
 *
 * Ação {"action":"triagem"}: só a triagem dos contatos pendentes (cron a cada 5 min).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_EXECUTION_MS = 110_000;
const MAX_PAGES = 12;
const PER_PAGE = 100; // máximo da Apollo; com 25 a busca parava nos 300 primeiros (lote 2, 22/11)
const LOCK_SECONDS = 600;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// deno-lint-ignore no-explicit-any
type Service = any;

const TRIAGE_BATCH = 8;      // leads por chamada ao modelo
const TRIAGE_PARALLEL = 4;   // chamadas em paralelo por rodada
const TRIAGE_MAX_ATTEMPTS = 3;
const ROUND_MS = 32_000;     // tempo reservado para uma rodada
const CRON_TRIAGE_MS = 45_000; // a ação "triagem" (cron) encerra antes dos 60 s do pg_net

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

/**
 * Marca o contato para triagem, a não ser que ele já esteja na cadência ou já tenha
 * passado pela triagem. Contato novo já nasce com a tag (newContactTags), sem janela
 * para a cadência matriculá-lo antes; aqui cobre o contato que já existia.
 */
async function markPendingTriage(service: Service, contactId: string): Promise<void> {
  const { data: enrolled } = await service.from('cadence_state').select('id').eq('contact_id', contactId).limit(1);
  if (Array.isArray(enrolled) && enrolled.length) return;
  const { data: c } = await service.from('contacts').select('tags, client_memory').eq('id', contactId).maybeSingle();
  const tags: string[] = Array.isArray(c?.tags) ? c.tags : [];
  if (tags.includes(TAG_PENDING) || tags.includes(TAG_DOUBT) || tags.includes(TAG_OUT) || rec(rec(c?.client_memory).triagem).veredito) return;
  await service.from('contacts').update({ tags: [...tags, TAG_PENDING] }).eq('id', contactId);
}

/**
 * Triagem dos contatos marcados com triagem_pendente, em lotes, até o tempo acabar.
 * OK: sai a tag pendente e o contato fica livre para a cadência. DÚVIDA: fica parado
 * (tag triagem_duvida) até uma pessoa decidir. FORA: perde a tag 'apollo' e o lead é
 * desqualificado. Erro do provedor encerra a rodada (o cron tenta de novo); lead que o
 * modelo não devolveu tenta de novo e, depois de 3 tentativas, vira DÚVIDA.
 */
async function runTriage(service: Service, deadline: number): Promise<Record<string, number | string>> {
  const stats: Record<string, number | string> = { avaliados: 0, ok: 0, duvida: 0, fora: 0 };
  // Uma rodada (até 4 lotes de 8 em paralelo) leva ~20-30 s; só começa outra se ainda
  // couber antes do prazo (o cron do pg_net desiste da chamada em 60 s).
  while (deadline - Date.now() > ROUND_MS) {
    const { data: contacts } = await service
      .from('contacts').select('id, tags, client_memory').contains('tags', [TAG_PENDING]).limit(TRIAGE_BATCH * TRIAGE_PARALLEL);
    const rows = (contacts ?? []) as Array<{ id: string; tags: string[] | null; client_memory: Record<string, unknown> | null }>;
    if (rows.length === 0) break;

    const { data: leadRows } = await service
      .from('apollo_leads')
      .select('id, contact_id, full_name, title, seniority, email, company_name, company_domain, company_industry, company_employees, company_city, company_state, city, state, raw, created_at')
      .in('contact_id', rows.map((r) => r.id))
      .order('created_at', { ascending: false });
    const leadByContact = new Map<string, TriageLead & { contact_id: string }>();
    for (const l of (leadRows ?? []) as Array<TriageLead & { contact_id: string }>) {
      if (!leadByContact.has(l.contact_id)) leadByContact.set(l.contact_id, l);
    }

    const now = new Date().toISOString();
    const apply = async (
      contact: typeof rows[number], leadId: string | null,
      veredito: 'OK' | 'DUVIDA' | 'FORA', persona: string | null, motivo: string,
    ) => {
      let tags = (contact.tags ?? []).filter((t) => t !== TAG_PENDING);
      if (veredito === 'DUVIDA') tags = Array.from(new Set([...tags, TAG_DOUBT]));
      if (veredito === 'FORA') tags = Array.from(new Set([...tags.filter((t) => t !== 'apollo'), TAG_OUT]));
      const mem = rec(contact.client_memory);
      await service.from('contacts').update({
        tags,
        client_memory: { ...mem, triagem: { veredito, persona, motivo, at: now } },
      }).eq('id', contact.id);
      if (veredito === 'FORA' && leadId) {
        await service.from('apollo_leads').update({ status: 'disqualified', disqualify_reason: `Triagem: ${motivo}` }).eq('id', leadId);
      }
      stats.avaliados = Number(stats.avaliados) + 1;
      const key = veredito === 'OK' ? 'ok' : veredito === 'DUVIDA' ? 'duvida' : 'fora';
      stats[key] = Number(stats[key]) + 1;
    };

    // Contato sem lead do Apollo para ler: não há o que avaliar, uma pessoa decide.
    for (const c of rows.filter((r) => !leadByContact.has(r.id))) {
      await apply(c, null, 'DUVIDA', null, 'Sem dados do Apollo para a triagem automática');
    }
    const batch = rows.filter((r) => leadByContact.has(r.id));
    if (batch.length === 0) continue;

    const chunks: typeof batch[] = [];
    for (let i = 0; i < batch.length; i += TRIAGE_BATCH) chunks.push(batch.slice(i, i + TRIAGE_BATCH));
    const settled = await Promise.allSettled(chunks.map((ch) => triageBatch(ch.map((c) => leadByContact.get(c.id)!))));
    const failed = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) {
      stats.erro = String(failed[0].reason instanceof Error ? failed[0].reason.message : failed[0].reason);
      console.error('[apollo-lead-sync] triagem falhou:', stats.erro);
    }
    const byLead = new Map(settled.flatMap((s) => s.status === 'fulfilled' ? s.value : []).map((r) => [r.id, r]));
    // Só os lotes que voltaram contam tentativa; lote com erro do provedor tenta de novo depois.
    const answered = chunks.filter((_, i) => settled[i].status === 'fulfilled').flat();
    for (const c of answered) {
      const lead = leadByContact.get(c.id)!;
      const r = byLead.get(lead.id);
      if (r) { await apply(c, lead.id, r.veredito, r.persona, r.motivo); continue; }
      const mem = rec(c.client_memory);
      const attempts = Number(mem.triagem_tentativas ?? 0) + 1;
      if (attempts >= TRIAGE_MAX_ATTEMPTS) {
        await apply(c, lead.id, 'DUVIDA', null, 'Triagem automática não concluiu');
      } else {
        await service.from('contacts').update({ client_memory: { ...mem, triagem_tentativas: attempts } }).eq('id', c.id);
      }
    }
    if (failed.length) break; // provedor com erro: encerra e o cron tenta de novo
  }
  return stats;
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

  const reqBody = rec(await request.json().catch(() => ({})));

  // Teste da triagem sem gravar nada: avalia leads já existentes (ids de apollo_leads),
  // em lotes paralelos, e devolve os vereditos — para comparar com a revisão manual.
  if (reqBody.action === 'triagem_teste') {
    const ids = (Array.isArray(reqBody.leadIds) ? reqBody.leadIds : []).filter((x): x is string => typeof x === 'string').slice(0, 48);
    if (ids.length === 0) return json(400, { error: 'Informe leadIds.' });
    const { data: leadRows } = await service
      .from('apollo_leads')
      .select('id, full_name, title, seniority, email, company_name, company_domain, company_industry, company_employees, company_city, company_state, city, state, raw')
      .in('id', ids);
    const leads = (leadRows ?? []) as TriageLead[];
    const batches: TriageLead[][] = [];
    for (let i = 0; i < leads.length; i += TRIAGE_BATCH) batches.push(leads.slice(i, i + TRIAGE_BATCH));
    const settled = await Promise.allSettled(batches.map((b) => triageBatch(b)));
    const results = settled.flatMap((s) => s.status === 'fulfilled' ? s.value : []);
    const errors = settled.filter((s) => s.status === 'rejected').map((s) => String((s as PromiseRejectedResult).reason));
    return json(200, { success: true, pedidos: ids.length, avaliados: results.length, results, errors });
  }

  if (reqBody.action === 'triagem') {
    try {
      const triagem = await runTriage(service, startedAt + CRON_TRIAGE_MS);
      return json(200, { success: true, triagem });
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : String(error) });
    }
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
    let qualifiedCount = 0;

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
      const { score, reasons, persona, qualified, rejection } = scoreLead(p);
      const organization = p.organization ?? {};
      // Exclusão (playbook): não prospectar domínio próprio nem cliente ativo.
      const excluded = isExcludedEmail(p.email)
        || isExcludedDomain(organization.primary_domain ?? organization.website_url ?? null);
      const admitted = qualified && !excluded;

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
          // Corte do playbook: só entra quem é P1/P3 E tem score ≥ 60. O resto é
          // registrado (para dedup e histórico), mas marcado como desqualificado
          // e não vira contato nem entra em campanha.
          status: !admitted ? 'disqualified' : (phone ? 'new' : 'no_phone'),
          disqualify_reason: admitted
            ? null
            : (excluded
              ? 'Domínio próprio ou cliente ativo'
              : (persona === null ? 'Cargo fora do ICP (P1/P3)' : (rejection ?? 'Score abaixo de 60'))),
          run_id: runId,
          raw: { person: p },
        })
        .select('id')
        .single();
      if (leadError) continue;
      const leadId = (lead as { id: string }).id;
      if (admitted) qualifiedCount += 1;

      // Identidade unificada: toda pessoa ADMITIDA vira um contato ÚNICO no
      // CRM, com e-mail + telefone na mesma linha, persona e score — inclusive
      // quando não há telefone (o lead só-e-mail entra no CRM e aguarda o canal
      // de e-mail da cadência, em vez de ficar parado como antes).
      let contactId: string | null = null;
      if (admitted) {
        contactId = await upsertUnifiedContact(service, {
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
          newContactTags: [TAG_PENDING],
        });
        if (contactId) {
          await service.from('apollo_leads').update({ contact_id: contactId }).eq('id', leadId);
          await markPendingTriage(service, contactId);
        }
      }

      insertedLeads.push({ id: leadId, contact_id: contactId, phone });
      if (phone) withPhone += 1;

      // Sem celular: pede a revelação assíncrona à Apollo só para quem qualifica
      // (não gasta crédito revelando telefone de lead que não entra no fluxo).
      if (!phone && admitted && settings.reveal_phones && settings.webhook_token) {
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

    // Triagem com o tempo que sobrou; o cron lis-apollo-triagem termina o resto.
    const deadline = startedAt + MAX_EXECUTION_MS - 20_000;
    const triagem = Date.now() < deadline ? await runTriage(service, deadline).catch((e) => ({ erro: String(e) })) : { adiada: 'sem tempo nesta rodada' };

    return json(200, {
      success: true,
      fetched,
      new_leads: insertedLeads.length,
      qualified: qualifiedCount,
      with_phone: withPhone,
      campaign_id: campaignId,
      triagem,
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
