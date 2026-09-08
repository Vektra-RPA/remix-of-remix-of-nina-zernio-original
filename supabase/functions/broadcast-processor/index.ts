import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getUserFromToken } from '../_shared/auth.ts';
import { enqueueTemplateForContact, type DispatchContact } from '../_shared/template-dispatch.ts';

/**
 * Motor de disparo em massa: processa uma campanha em lotes, respeitando o
 * ritmo configurado (atraso entre mensagens e pausa entre lotes) e se
 * reinvocando até concluir. O envio em si reaproveita a fila do
 * whatsapp-sender via _shared/template-dispatch.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_EXECUTION_MS = 50_000;
const PER_RECIPIENT_BUDGET_MS = 4_000;
const LOCK_DURATION_S = 90;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min: number, max: number) => Math.floor(min + Math.random() * Math.max(0, max - min));

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Método não permitido' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const service = createClient(supabaseUrl, serviceKey);

  try {
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    const internal = token === serviceKey;

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
          return json(403, { error: 'Sem permissão para disparar campanhas.', code: 'not_allowed' });
        }
      }
    }

    const body = await request.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id ?? '').trim();
    if (!campaignId) return json(400, { error: 'campaign_id é obrigatório.' });

    const { data: campaign, error: campaignError } = await service
      .from('broadcast_campaigns').select('*').eq('id', campaignId).maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) return json(404, { error: 'Campanha não encontrada.' });

    if (['paused', 'completed', 'failed', 'canceled'].includes(campaign.status)) {
      return json(200, { success: true, message: `Campanha está ${campaign.status}` });
    }

    // ── Transição/trava atômica ──
    if (campaign.status === 'draft' || campaign.status === 'queued') {
      const { data: transition } = await service
        .from('broadcast_campaigns')
        .update({ status: 'sending', started_at: campaign.started_at ?? new Date().toISOString(), next_batch_at: null })
        .eq('id', campaignId)
        .eq('status', campaign.status)
        .select('id');
      if (!transition || transition.length === 0) {
        return json(200, { success: true, message: 'Outra execução assumiu a campanha.' });
      }
    } else {
      if (campaign.next_batch_at) {
        const waitMs = new Date(campaign.next_batch_at).getTime() - Date.now();
        if (waitMs > 0) {
          await sleep(Math.min(waitMs, 20_000));
          selfInvoke(service, campaignId);
          return json(200, { success: true, message: 'Aguardando próximo lote' });
        }
      }

      const lockUntil = new Date(Date.now() + LOCK_DURATION_S * 1000).toISOString();
      const nowIso = new Date().toISOString();

      const { data: lock1 } = await service
        .from('broadcast_campaigns').update({ next_batch_at: lockUntil })
        .eq('id', campaignId).is('next_batch_at', null).select('id');
      let locked = !!(lock1 && lock1.length > 0);
      if (!locked) {
        const { data: lock2 } = await service
          .from('broadcast_campaigns').update({ next_batch_at: lockUntil })
          .eq('id', campaignId).lt('next_batch_at', nowIso).select('id');
        locked = !!(lock2 && lock2.length > 0);
      }
      if (!locked) return json(200, { success: true, message: 'Outra execução está processando.' });
    }

    const batchSize = Math.max(1, campaign.batch_size ?? 20);
    const delayMinMs = Math.max(0, (campaign.delay_min_s ?? 30) * 1000);
    const delayMaxMs = Math.max(delayMinMs, (campaign.delay_max_s ?? 50) * 1000);
    const pauseMinMs = Math.max(0, (campaign.pause_between_batches_min ?? 10) * 60_000);
    const pauseMaxMs = Math.max(pauseMinMs, (campaign.pause_between_batches_max ?? 15) * 60_000);
    const params: string[] = Array.isArray(campaign.template_params) ? campaign.template_params.map(String) : [];

    const { data: recipientsData, error: recipientsError } = await service
      .from('broadcast_recipients').select('*')
      .eq('campaign_id', campaignId).eq('status', 'pending')
      .order('created_at', { ascending: true }).limit(batchSize);
    if (recipientsError) throw recipientsError;
    const recipients = recipientsData ?? [];

    if (recipients.length === 0) {
      await service.from('broadcast_campaigns')
        .update({ status: 'completed', completed_at: new Date().toISOString(), next_batch_at: null })
        .eq('id', campaignId);
      return json(200, { success: true, message: 'Campanha concluída', processed: 0 });
    }

    const startedAt = Date.now();
    let processed = 0, sent = 0, failed = 0, hitTimeout = false;

    for (const recipient of recipients) {
      if (Date.now() - startedAt + PER_RECIPIENT_BUDGET_MS > MAX_EXECUTION_MS) {
        hitTimeout = true;
        break;
      }

      if (processed > 0 && processed % 5 === 0) {
        const { data: current } = await service
          .from('broadcast_campaigns').select('status').eq('id', campaignId).maybeSingle();
        if (current?.status !== 'sending') break;
      }

      try {
        if (!recipient.contact_id) throw new Error('Contato removido');
        const { data: contactRow, error: contactError } = await service
          .from('contacts').select('id, name, call_name, phone_number, is_blocked')
          .eq('id', recipient.contact_id).maybeSingle();
        if (contactError) throw contactError;
        const contact = contactRow as (DispatchContact | null);
        if (!contact) throw new Error('Contato não encontrado');
        if (contact.is_blocked) throw new Error('Contato bloqueado');
        if (!contact.phone_number) throw new Error('Contato sem telefone');

        await enqueueTemplateForContact(service, {
          contact,
          name: campaign.template_name,
          language: campaign.template_language || 'pt_BR',
          bodyText: campaign.template_body || '',
          params,
        });

        await service.from('broadcast_recipients')
          .update({ status: 'sent', sent_at: new Date().toISOString(), error_message: null })
          .eq('id', recipient.id);
        sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido';
        await service.from('broadcast_recipients')
          .update({ status: 'failed', error_message: message }).eq('id', recipient.id);
        failed++;
      }

      processed++;

      if (processed < recipients.length) {
        const delay = randomBetween(delayMinMs, delayMaxMs);
        if (Date.now() - startedAt + delay + PER_RECIPIENT_BUDGET_MS > MAX_EXECUTION_MS) {
          hitTimeout = true;
          break;
        }
        await sleep(delay);
      }
    }

    if (sent > 0) {
      const { error: triggerError } = await service.functions.invoke('whatsapp-sender');
      if (triggerError) console.error('[broadcast-processor] trigger error', triggerError.message);
    }

    await service.from('broadcast_campaigns').update({
      sent_count: (campaign.sent_count || 0) + sent,
      failed_count: (campaign.failed_count || 0) + failed,
    }).eq('id', campaignId);

    const { count: remaining } = await service
      .from('broadcast_recipients').select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).eq('status', 'pending');

    if ((remaining ?? 0) > 0) {
      const { data: latest } = await service
        .from('broadcast_campaigns').select('status').eq('id', campaignId).maybeSingle();
      if (latest?.status === 'sending') {
        const fullBatch = !hitTimeout && processed >= recipients.length;
        const nextBatchAt = fullBatch
          ? new Date(Date.now() + randomBetween(pauseMinMs, pauseMaxMs)).toISOString()
          : null;
        await service.from('broadcast_campaigns').update({ next_batch_at: nextBatchAt }).eq('id', campaignId);
        await sleep(300);
        selfInvoke(service, campaignId);
      } else {
        await service.from('broadcast_campaigns').update({ next_batch_at: null }).eq('id', campaignId);
      }
    } else {
      await service.from('broadcast_campaigns')
        .update({ status: 'completed', completed_at: new Date().toISOString(), next_batch_at: null })
        .eq('id', campaignId);
    }

    return json(200, { success: true, processed, sent, failed, remaining: remaining ?? 0, hitTimeout });
  } catch (error) {
    console.error('[broadcast-processor] error', error instanceof Error ? error.message : error);
    return json(500, { success: false, error: 'Falha ao processar a campanha.' });
  }
});

// deno-lint-ignore no-explicit-any
function selfInvoke(service: any, campaignId: string) {
  service.functions.invoke('broadcast-processor', { body: { campaign_id: campaignId } }).catch(console.error);
}
