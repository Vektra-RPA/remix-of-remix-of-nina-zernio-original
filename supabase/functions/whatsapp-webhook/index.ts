import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureEdgeSecrets } from "../_shared/system-config.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROUPING_DELAY_MS = 10000; // 10 seconds

/**
 * Playbook (Passo 4, regras de parada): qualquer resposta pausa a automação — também
 * pelo WhatsApp, não só por e-mail. Marca o contato como "respondeu" (o cadence-worker
 * nunca mais o matricula) e cancela os toques frios pendentes.
 */
async function pauseColdCadence(supabase: any, contact: any): Promise<void> {
  try {
    const tags: string[] = Array.isArray(contact.tags) ? contact.tags : [];
    const memory = contact.client_memory && typeof contact.client_memory === 'object' ? contact.client_memory : {};
    if (!tags.includes('replied')) {
      await supabase.from('contacts').update({
        tags: [...tags, 'replied'],
        client_memory: { ...memory, replied_at: memory.replied_at ?? new Date().toISOString(), last_reply_channel: 'whatsapp' },
      }).eq('id', contact.id);
    }
    await supabase.from('cadence_state')
      .update({ status: 'cancelled', last_error: 'respondeu pelo WhatsApp' })
      .eq('contact_id', contact.id)
      .eq('status', 'pending');
  } catch (error) {
    console.error('[Webhook] Falha ao pausar a cadência:', error);
  }
}

/**
 * Celular brasileiro chega da Meta às vezes sem o 9 extra (wa_id de 12 dígitos,
 * ex.: 554199998888) enquanto o contato da Apollo foi gravado com 13 dígitos
 * (5541999998888) — e vice-versa. Devolve o número e a variante para a busca.
 */
function brPhoneVariants(phone: string): string[] {
  const digits = String(phone || '').replace(/\D/g, '');
  const variants = [phone];
  if (digits.startsWith('55') && digits.length === 12) {
    variants.push(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  } else if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    variants.push(`${digits.slice(0, 4)}${digits.slice(5)}`);
  }
  return Array.from(new Set(variants));
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const requestUrl = new URL(req.url);
    const requestWebhookKey = requestUrl.searchParams.get('key');
    const { data: webhookSettings, error: webhookSettingsError } = await supabase
      .from('nina_settings')
      .select('whatsapp_verify_token, whatsapp_webhook_key')
      .limit(1)
      .maybeSingle();

    if (webhookSettingsError) {
      console.error('[Webhook] Failed to load webhook settings:', webhookSettingsError);
      return new Response('Webhook configuration unavailable', { status: 503, headers: corsHeaders });
    }

    // Instalações legadas, sem chave, continuam aceitando a URL estática.
    // Depois da primeira rotação, a chave passa a ser obrigatória em GET e POST,
    // o que invalida de verdade toda Callback URL anterior.
    if (
      webhookSettings?.whatsapp_webhook_key &&
      requestWebhookKey !== webhookSettings.whatsapp_webhook_key
    ) {
      console.error('[Webhook] Callback URL key mismatch');
      return new Response('Forbidden', { status: 403, headers: corsHeaders });
    }

    // GET request = Webhook verification from WhatsApp
    if (req.method === 'GET') {
      const mode = requestUrl.searchParams.get('hub.mode');
      const token = requestUrl.searchParams.get('hub.verify_token');
      const challenge = requestUrl.searchParams.get('hub.challenge');
      const verifyToken = webhookSettings?.whatsapp_verify_token || 'webhook-verify-token';

      if (mode === 'subscribe' && token === verifyToken) {
        console.log('[Webhook] Verification successful');
        return new Response(challenge, { status: 200, headers: corsHeaders });
      } else {
        console.error('[Webhook] Verification failed');
        return new Response('Forbidden', { status: 403, headers: corsHeaders });
      }
    }

    // POST request = Incoming message from WhatsApp
    if (req.method === 'POST') {
      const body = await req.json();
      console.log('[Webhook] Received payload:', JSON.stringify(body, null, 2));

      // Garante os secrets do Vault (cron sweeps) no caminho síncrono —
      // o waitUntil que dispara o orchestrator pode morrer, o sweep não
      await ensureEdgeSecrets(supabase);

      // Extract message data from WhatsApp Cloud API format
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      
      if (!value) {
        console.log('[Webhook] No value in payload, ignoring');
        return new Response(JSON.stringify({ status: 'ignored' }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const messages = value.messages;
      const contacts = value.contacts;
      const phoneNumberId = value.metadata?.phone_number_id;

      // Find the user who owns this phone number ID
      const { data: ownerSettings } = await supabase
        .from('nina_settings')
        .select('user_id, whatsapp_access_token')
        .eq('whatsapp_phone_number_id', phoneNumberId)
        .maybeSingle();

      let ownerId = ownerSettings?.user_id || null;
      
      // Se não encontrou owner específico ou user_id é null, buscar o admin do sistema
      if (!ownerId) {
        console.log('[Webhook] No owner in settings, looking for system admin...');
        const { data: adminRole } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('role', 'admin')
          .limit(1)
          .maybeSingle();
        
        ownerId = adminRole?.user_id || null;
        
        if (ownerId) {
          console.log('[Webhook] Using admin as owner:', ownerId);
        } else {
          console.warn('[Webhook] No admin found in system - contacts will have null user_id');
        }
      } else {
        console.log('[Webhook] Found owner user_id:', ownerId);
      }

      // Handle status updates (delivered, read, etc)
      if (value.statuses) {
        for (const status of value.statuses) {
          console.log('[Webhook] Status update:', status);
          
          // Update message status in database
          if (status.id) {
            const statusMap: Record<string, string> = {
              'sent': 'sent',
              'delivered': 'delivered',
              'read': 'read',
              'failed': 'failed'
            };
            
            const newStatus = statusMap[status.status];
            if (newStatus) {
              // Falha: guarda o motivo da Meta (ex.: 131026 número sem WhatsApp,
              // 131049 limite de marketing por usuário) para o time e a cadência.
              let failure: Record<string, unknown> = {};
              if (newStatus === 'failed' && Array.isArray(status.errors) && status.errors.length) {
                const { data: current } = await supabase
                  .from('messages').select('metadata').eq('whatsapp_message_id', status.id).maybeSingle();
                const meta = current?.metadata && typeof current.metadata === 'object' ? current.metadata : {};
                const err = status.errors[0] || {};
                failure = {
                  metadata: {
                    ...meta,
                    whatsapp_error: {
                      code: err.code ?? null,
                      title: err.title ?? null,
                      details: err.error_data?.details ?? err.message ?? null,
                      at: new Date().toISOString(),
                    },
                  },
                };
              }
              await supabase
                .from('messages')
                .update({
                  status: newStatus,
                  ...(newStatus === 'delivered' && { delivered_at: new Date().toISOString() }),
                  ...(newStatus === 'read' && { read_at: new Date().toISOString() }),
                  ...failure,
                })
                .eq('whatsapp_message_id', status.id);
            }
          }
        }
        
        return new Response(JSON.stringify({ status: 'processed_statuses' }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Process incoming messages - CREATE RECORDS IMMEDIATELY
      if (messages && messages.length > 0) {
        const processAfter = new Date(Date.now() + GROUPING_DELAY_MS).toISOString();

        for (const message of messages) {
          const contactInfo = contacts?.find((c: any) => c.wa_id === message.from);
          const phoneNumber = message.from;
          const whatsappId = contactInfo?.wa_id || phoneNumber;
          const contactName = contactInfo?.profile?.name || null;

          // 1. Get or create contact IMMEDIATELY
          let { data: contact } = await supabase
            .from('contacts')
            .select('*')
            .eq('phone_number', phoneNumber)
            .maybeSingle();

          // Lead da cadência com o celular gravado no outro formato (com/sem o 9).
          if (!contact) {
            const { data: byVariant } = await supabase
              .from('contacts')
              .select('*')
              .in('phone_number', brPhoneVariants(phoneNumber))
              .limit(1)
              .maybeSingle();
            if (byVariant) {
              contact = byVariant;
              if (!byVariant.whatsapp_id) {
                await supabase.from('contacts').update({ whatsapp_id: whatsappId }).eq('id', byVariant.id);
              }
            }
          }

          if (!contact) {
            const { data: newContact, error: contactError } = await supabase
              .from('contacts')
              .insert({
                phone_number: phoneNumber,
                whatsapp_id: whatsappId,
                name: contactName,
                call_name: contactName?.split(' ')[0] || null,
                user_id: null
              })
              .select()
              .single();

            if (contactError) {
              console.error('[Webhook] Error creating contact:', contactError);
              continue;
            }
            contact = newContact;
            console.log('[Webhook] Created new contact:', contact.id);
          } else {
            // Update contact activity
            const updates: any = { last_activity: new Date().toISOString() };
            if (contactName && !contact.name) {
              updates.name = contactName;
              updates.call_name = contactName.split(' ')[0];
            }
            // Removed user_id update to maintain single-tenant null pattern
            
            await supabase
              .from('contacts')
              .update(updates)
              .eq('id', contact.id);
          }

          // 2. Get or create conversation IMMEDIATELY
          // Só a conversa de WhatsApp: o lead da Apollo também tem uma conversa de
          // e-mail ativa, e a resposta por aqui não pode cair nela (a Lis
          // responderia por e-mail).
          let { data: conversation } = await supabase
            .from('conversations')
            .select('*')
            .eq('contact_id', contact.id)
            .eq('is_active', true)
            .eq('channel', 'whatsapp')
            .order('last_message_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!conversation) {
            const { data: newConversation, error: convError } = await supabase
              .from('conversations')
              .insert({
                contact_id: contact.id,
                channel: 'whatsapp',
                status: 'nina',
                is_active: true,
                user_id: null
              })
              .select()
              .single();

            if (convError) {
              console.error('[Webhook] Error creating conversation:', convError);
              continue;
            }
            conversation = newConversation;
            console.log('[Webhook] Created new conversation:', conversation.id);
          }
          // Removed user_id update to maintain single-tenant null pattern

          // 3. Determine message content and type
          let messageContent = '';
          let messageType = 'text';
          let mediaType = null;

          switch (message.type) {
            case 'text':
              messageContent = message.text?.body || '';
              messageType = 'text';
              break;
            case 'image':
              messageContent = message.image?.caption || '[imagem recebida]';
              messageType = 'image';
              mediaType = 'image';
              break;
            case 'audio':
              // Audio will be transcribed by message-grouper
              messageContent = '[áudio - processando transcrição...]';
              messageType = 'audio';
              mediaType = 'audio';
              break;
            case 'video':
              messageContent = message.video?.caption || '[vídeo recebido]';
              messageType = 'video';
              mediaType = 'video';
              break;
            case 'document':
              messageContent = message.document?.filename || '[documento recebido]';
              messageType = 'document';
              mediaType = 'document';
              break;
            default:
              messageContent = `[${message.type}]`;
          }

          // 4. Create message IMMEDIATELY (for realtime updates)
          const { data: dbMessage, error: msgError } = await supabase
            .from('messages')
            .insert({
              conversation_id: conversation.id,
              whatsapp_message_id: message.id,
              content: messageContent,
              type: messageType,
              from_type: 'user',
              status: 'sent',
              media_type: mediaType,
              sent_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
              metadata: { 
                original_type: message.type,
                media_id: message.audio?.id || message.image?.id || message.video?.id || message.document?.id || null
              }
            })
            .select()
            .single();

          if (msgError) {
            // If duplicate key error, message was already processed
            if (msgError.code === '23505') {
              console.log('[Webhook] Duplicate message ignored:', message.id);
              continue;
            }
            console.error('[Webhook] Error creating message:', msgError);
            continue;
          }

          console.log('[Webhook] Created message:', dbMessage.id, 'for conversation:', conversation.id);

          await pauseColdCadence(supabase, contact);

          // 5. Update conversation last_message_at
          await supabase
            .from('conversations')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', conversation.id);

          // 6. FIRST reset timer for all pending messages from same phone, THEN insert new queue entry
          await supabase
            .from('message_grouping_queue')
            .update({ process_after: processAfter })
            .eq('processed', false)
            .eq('phone_number_id', phoneNumberId)
            .filter('message_data->>from', 'eq', phoneNumber);

          // 7. Insert into message_grouping_queue with message_id reference
          const { error: queueError } = await supabase
            .from('message_grouping_queue')
            .insert({
              whatsapp_message_id: message.id,
              phone_number_id: phoneNumberId,
              message_id: dbMessage.id,
              message_data: message,
              contacts_data: contactInfo || null,
              process_after: processAfter
            });

          if (queueError) {
            if (queueError.code === '23505') {
              console.log('[Webhook] Duplicate queue entry ignored:', message.id);
            } else {
              console.error('[Webhook] Queue insert error:', queueError);
            }
          } else {
            console.log('[Webhook] Message queued:', message.id, 'process_after:', processAfter);
          }
        }

        // Trigger message-grouper in background (non-blocking)
        EdgeRuntime.waitUntil(
          fetch(`${supabaseUrl}/functions/v1/message-grouper`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({ triggered_by: 'whatsapp-webhook' })
          }).catch(err => console.error('[Webhook] Error triggering message-grouper:', err))
        );
      }

      return new Response(JSON.stringify({ status: 'processed' }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  } catch (error) {
    console.error('[Webhook] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
