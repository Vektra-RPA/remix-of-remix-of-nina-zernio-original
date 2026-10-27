import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { extractPhone } from '../_shared/apollo.ts';

/**
 * Recebe da Apollo o telefone revelado de forma assíncrona e atualiza o lead e o
 * contato do CRM. O toque de WhatsApp sai pela cadência (D3), depois do e-mail 1.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Método não permitido' });

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = new URL(request.url).searchParams.get('token') ?? '';

  const { data: settings } = await service
    .from('apollo_search_settings').select('webhook_token').limit(1).maybeSingle();
  if (!token || !settings?.webhook_token || token !== settings.webhook_token) {
    return json(401, { error: 'Unauthorized' });
  }

  try {
    const payload = await request.json().catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    const people: any[] = payload?.people ?? (payload?.person ? [payload.person] : []);
    let updated = 0;

    for (const person of people) {
      const apolloId = person?.id ? String(person.id) : null;
      if (!apolloId) continue;
      const phone = extractPhone(person);
      if (!phone) continue;
      const { data: leads, error } = await service
        .from('apollo_leads')
        .update({ phone_number: phone, status: 'new' })
        .eq('apollo_person_id', apolloId)
        .is('phone_number', null)
        .select('contact_id');
      if (error) continue;
      updated += 1;

      // Leva o celular também para o contato do CRM (é dele que a cadência e o
      // webhook do WhatsApp leem). Sem isso o número ficava só em apollo_leads.
      for (const lead of (leads ?? []) as Array<{ contact_id: string | null }>) {
        if (!lead.contact_id) continue;
        const { error: contactError } = await service
          .from('contacts')
          .update({ phone_number: phone })
          .eq('id', lead.contact_id)
          .is('phone_number', null);
        if (contactError) console.error('apollo-phone-webhook: telefone no contato falhou:', contactError.message);
      }
    }

    return json(200, { success: true, updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('apollo-phone-webhook falhou:', message);
    return json(500, { error: message });
  }
});
