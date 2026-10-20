import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  runNinaAgent,
  fetchCanonicalFacts,
  buildGroundingSection,
  buildEnhancedPrompt,
  processPromptTemplate,
  resolveModelSettings,
  modelForTier,
} from "../_shared/nina-engine.ts";
import { ensureEdgeSecrets } from "../_shared/system-config.ts";
import {
  fetchPublishedAgentRuntimeConfig,
  type PublishedAgentRuntimeConfig,
} from "../_shared/agent-config.ts";
import {
  getActionPolicy,
  hasExplicitConfirmation,
  validateScheduleRequest,
} from "../_shared/action-policy.ts";
import { redactSensitiveText, redactSensitiveValue } from "../_shared/privacy.ts";
import { consumeRateLimit, RateLimitError } from "../_shared/rate-limit.ts";
import { buildHandoffPackage } from "../_shared/handoff-package.ts";
import { enqueueTemplateForContact } from "../_shared/template-dispatch.ts";
import { upsertUnifiedContact, derivePersona } from "../_shared/lead-identity.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

const checkAvailabilityTool = {
  type: "function",
  function: {
    name: "check_availability",
    description: "Consultar se uma data e horário estão livres antes de propor ou confirmar um agendamento. Esta ação não cria evento.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Data no formato YYYY-MM-DD" },
        time: { type: "string", description: "Horário no formato HH:MM" },
        duration: { type: "number", description: "Duração em minutos" },
      },
      required: ["date", "time"],
    },
  },
};

// Tool definition for appointment creation
const createAppointmentTool = {
  type: "function",
  function: {
    name: "create_appointment",
    description: "Criar um agendamento/reunião/demo para o cliente. Use quando o cliente solicitar agendar algo, confirmar uma data/horário para reunião, demo ou suporte.",
    parameters: {
      type: "object",
      properties: {
        title: { 
          type: "string", 
          description: "Título do agendamento (ex: 'Demo do Produto', 'Reunião de Kickoff', 'Suporte Técnico')" 
        },
        date: { 
          type: "string", 
          description: "Data no formato YYYY-MM-DD. Use a data mencionada pelo cliente." 
        },
        time: { 
          type: "string", 
          description: "Horário no formato HH:MM (24h). Ex: '14:00', '09:30'" 
        },
        duration: { 
          type: "number", 
          description: "Duração em minutos. Padrão: 60. Opções comuns: 15, 30, 45, 60, 90, 120" 
        },
        type: { 
          type: "string", 
          enum: ["demo", "meeting", "support", "followup"],
          description: "Tipo do agendamento: demo (demonstração), meeting (reunião geral), support (suporte técnico), followup (acompanhamento)" 
        },
        description: { 
          type: "string", 
          description: "Descrição ou pauta da reunião. Resuma o que será discutido." 
        },
        confirmation_evidence: {
          type: "string",
          description: "Trecho literal recente escrito pelo lead que confirma data e horário. Sem essa evidência, não execute.",
        },
      },
      required: ["title", "date", "time", "type", "confirmation_evidence"]
    }
  }
};

// Tool definition for rescheduling appointments
const rescheduleAppointmentTool = {
  type: "function",
  function: {
    name: "reschedule_appointment",
    description: "Reagendar um agendamento existente do cliente. Use quando o cliente pedir para mudar a data ou horário de um agendamento já existente.",
    parameters: {
      type: "object",
      properties: {
        new_date: { 
          type: "string", 
          description: "Nova data no formato YYYY-MM-DD" 
        },
        new_time: { 
          type: "string", 
          description: "Novo horário no formato HH:MM (24h). Ex: '14:00', '09:30'" 
        },
        reason: { 
          type: "string", 
          description: "Motivo do reagendamento (opcional)" 
        },
        confirmation_evidence: {
          type: "string",
          description: "Trecho literal recente escrito pelo lead autorizando o novo dia e horário.",
        },
      },
      required: ["new_date", "new_time", "confirmation_evidence"]
    }
  }
};

// Tool definition for canceling appointments
const cancelAppointmentTool = {
  type: "function",
  function: {
    name: "cancel_appointment",
    description: "Cancelar um agendamento existente do cliente. Use quando o cliente pedir para cancelar ou desmarcar um agendamento.",
    parameters: {
      type: "object",
      properties: {
        reason: { 
          type: "string", 
          description: "Motivo do cancelamento" 
        },
        confirmation_evidence: {
          type: "string",
          description: "Trecho literal recente escrito pelo lead confirmando o cancelamento.",
        },
      },
      required: ["confirmation_evidence"]
    }
  }
};

const humanHandoffTool = {
  type: "function",
  function: {
    name: "human_handoff",
    description: "Transferir a conversa para atendimento humano. Use em pedido explícito do lead ou quando a política publicada exigir handoff.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Motivo objetivo do encaminhamento" },
        summary: { type: "string", description: "Resumo factual e curto para a equipe humana" },
        confirmation_evidence: {
          type: "string",
          description: "Trecho literal recente escrito pelo lead pedindo ou aceitando o atendimento humano.",
        },
      },
      required: ["reason", "summary", "confirmation_evidence"],
    },
  },
};

// Regra fixa da plataforma: opt-out independe da configuração comercial da
// agente. A ferramenta transforma o pedido explícito em estado persistente.
const registerOptOutTool = {
  type: "function",
  function: {
    name: "register_opt_out",
    description: "Registrar imediatamente que o lead não quer mais receber mensagens e pausar a conversa. Use quando ele pedir para parar, sair da lista ou não receber novos contatos.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Motivo curto e factual" },
        confirmation_evidence: {
          type: "string",
          description: "Trecho literal recente escrito pelo lead pedindo para não receber novas mensagens.",
        },
      },
      required: ["reason", "confirmation_evidence"],
    },
  },
};

// LGPD: registra a autorização do lead para continuar a comunicação (playbook
// Passo 3.3/5.5) como dado auditável. Negar a autorização encerra e suprime.
const registerConsentTool = {
  type: "function",
  function: {
    name: "register_consent",
    description: "Registrar a autorização (consentimento LGPD) do lead para continuar a comunicação. Use assim que ele responder ao pedido de autorização: granted=true quando autorizar ('sim', 'pode', 'claro'), granted=false quando negar ('não', 'não quero'). Grava canal, data/hora e a frase do lead. Negar também encerra e suprime o contato. Não proponha reunião nem envie material antes de um granted=true registrado.",
    parameters: {
      type: "object",
      properties: {
        granted: { type: "boolean", description: "true se o lead autorizou continuar a conversa; false se negou." },
        channel: { type: "string", description: "Canal onde a autorização ocorreu: 'whatsapp' ou 'email'." },
        lead_quote: { type: "string", description: "Trecho literal do que o lead respondeu ao pedido de autorização." },
        request_text: { type: "string", description: "O texto do pedido de autorização que você enviou." },
      },
      required: ["granted", "lead_quote"],
    },
  },
};

// Playbook 5.4 ("Não sou eu, fale com [pessoa]"): registra a indicação e cria o
// contato indicado marcado para o time dar o primeiro toque (não entra na cadência
// fria — indicação é um toque diferente).
const registerReferralTool = {
  type: "function",
  function: {
    name: "register_referral",
    description: "Registrar uma indicação quando o lead disser que não é a pessoa certa e apontar outra ('fale com X'). Guarda quem foi indicado (nome e, se o lead informar, cargo, e-mail e/ou telefone) e cria o novo contato marcado como indicação para o time dar o primeiro toque. Use só quando o lead indicar explicitamente outra pessoa.",
    parameters: {
      type: "object",
      properties: {
        referred_name: { type: "string", description: "Nome da pessoa indicada." },
        referred_role: { type: "string", description: "Cargo ou área da pessoa indicada, se o lead disser." },
        referred_email: { type: "string", description: "E-mail da pessoa indicada, se o lead informar." },
        referred_phone: { type: "string", description: "Telefone da pessoa indicada, se o lead informar." },
        confirmation_evidence: { type: "string", description: "Trecho literal recente em que o lead indicou a outra pessoa." },
      },
      required: ["referred_name", "confirmation_evidence"],
    },
  },
};

// Checklists diagnósticos do playbook (Passo 5.3) — texto aprovado, igual ao que
// está na base de conhecimento (src/data/playbookKnowledge.ts). São usados em
// CONVERSA ATIVA (não em toque frio): a Lis compartilha o checklist da persona
// do lead. Verbatim — a ferramenta devolve o texto exato para não parafrasear.
const CHECKLIST_P1 = [
  'Checklist · Cinco perguntas para saber se as decisões da sua indústria dependem demais de você.',
  '',
  '1. Você sabe, neste momento, quanto já está comprometido em compras e pagamentos no mês contra o que a empresa pode gastar?',
  '2. Alguma ordem de compra ou pagamento fica esperando a sua aprovação porque falta informação para decidir?',
  '3. Você confia que as compras estão sendo fechadas pelo melhor negócio possível, ou aprova sem conseguir conferir?',
  '4. A precificação de produtos novos passa por você? Existe uma regra clara ou depende de conversa caso a caso?',
  '5. Se você ficasse uma semana sem aprovar nada, o que pararia primeiro?',
  '',
  'Como ler: se você respondeu "não sei", "depende de mim" ou "fica parado" em três ou mais, há um gargalo de informação e de regra, não de pessoas. É o tipo de problema que uma conversa de 30 minutos ajuda a mapear.',
].join('\n');

const CHECKLIST_P3 = [
  'Checklist · Cinco rotinas manuais que atrasam o fechamento da indústria.',
  '',
  '1. As notas fiscais dos fornecedores só entram no sistema perto do fim do mês?',
  '2. Alguém confere manualmente as notas emitidas contra as ordens de compra em aberto?',
  '3. As baixas de inventário ficam pendentes na virada do mês?',
  '4. As conciliações são feitas à mão ou só depois do fechamento?',
  '5. Existe alguma etapa do fechamento que só uma pessoa sabe fazer?',
  '',
  'Como ler: cada "sim" é uma rotina candidata a automação. Três ou mais indicam que o prazo do fechamento está sendo definido pelo trabalho manual e não pela complexidade da empresa.',
].join('\n');

// Compartilha o checklist diagnóstico na conversa, já escolhido pela persona do
// lead (P1 dono/sócio · P3 diretor administrativo-financeiro). Ação benigna
// (só devolve texto) — tratada ANTES do portão de confirmação explícita.
const shareChecklistTool = {
  type: "function",
  function: {
    name: "share_checklist",
    description: "Compartilhar com o lead o checklist diagnóstico curto do playbook (Passo 5.3), já escolhido automaticamente pela persona do lead (P1 = dono/sócio/CEO; P3 = diretor/gerente administrativo-financeiro). Use em CONVERSA ATIVA quando for útil oferecer um material rápido que ajude o lead a enxergar os gargalos — por exemplo, quando ele demonstra interesse mas ainda não quer marcar reunião, ou pede algo prático. A ferramenta devolve o texto EXATO; envie as perguntas na íntegra, sem reescrever nem resumir.",
    parameters: {
      type: "object",
      properties: {
        persona_hint: {
          type: "string",
          enum: ["P1", "P3"],
          description: "Opcional. Só informe se tiver forte evidência do perfil e a persona ainda não estiver definida no CRM (P1 = dono/sócio/CEO; P3 = diretor/gerente administrativo-financeiro).",
        },
      },
    },
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // O endpoint drena uma fila global com service role. Apenas webhooks, cron e
  // outras Edge Functions internas podem acioná-lo; um JWT comum não basta.
  const { requireServiceRole } = await import("../_shared/auth.ts");
  const authFail = requireServiceRole(req, corsHeaders);
  if (authFail) return authFail;

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Diagnóstico de voz (só service role): gera e sobe um áudio curto sem enviar a ninguém.
    const requestBody = await req.clone().json().catch(() => ({}));
    if (requestBody?.action === 'tts_check') {
      const { data: ttsSettings } = await supabase.from('nina_settings').select('*').limit(1).maybeSingle();
      lastAudioError = '';
      const voiceSettings = ttsSettings && typeof requestBody.voice_id === 'string'
        ? { ...ttsSettings, elevenlabs_voice_id: requestBody.voice_id }
        : ttsSettings;
      const buffer = voiceSettings ? await generateAudioElevenLabs(voiceSettings, 'Olá! Aqui é a Lis, da Trajetória Consultoria. Este é um teste de voz.') : null;
      const url = buffer ? await uploadAudioToStorage(supabase, buffer, 'tts-check') : null;
      return new Response(JSON.stringify({ ok: !!url, bytes: buffer?.byteLength ?? 0, url, error: lastAudioError || null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Nina] Starting orchestration...');

    // Mantém os secrets do Vault em dia (cron sweeps dependem deles) —
    // idempotente: a RPC só escreve quando o valor mudou
    await ensureEdgeSecrets(supabase);

    // Claim batch of messages to process
    const { data: queueItems, error: claimError } = await supabase
      .rpc('claim_nina_processing_batch', { p_limit: 10 });

    if (claimError) {
      console.error('[Nina] Error claiming batch:', claimError);
      throw claimError;
    }

    if (!queueItems || queueItems.length === 0) {
      console.log('[Nina] No messages to process');
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[Nina] Processing ${queueItems.length} messages`);

    let processed = 0;

    for (const item of queueItems) {
      let runtimeContext: PublishedAgentRuntimeConfig | null = null;
      try {
        // Get user_id from conversation to fetch correct settings
        const { data: conversation } = await supabase
          .from('conversations')
          .select('user_id')
          .eq('id', item.conversation_id)
          .single();

        if (!conversation) {
          console.log('[Nina] Conversation not found:', item.conversation_id);
          await supabase
            .from('nina_processing_queue')
            .update({ 
              status: 'failed', 
              processed_at: new Date().toISOString(),
              error_message: 'Conversation not found'
            })
            .eq('id', item.id);
          continue;
        }

        // Buscar settings com fallback triplo (user_id → global → any)
        let settings = null;
        
        // 1. Tentar buscar por user_id da conversa
        if (conversation.user_id) {
          const { data: userSettings } = await supabase
            .from('nina_settings')
            .select('*')
            .eq('user_id', conversation.user_id)
            .maybeSingle();
          settings = userSettings;
          if (settings) {
            console.log('[Nina] Found settings for user:', conversation.user_id);
          }
        }
        
        // 2. Se não encontrou, tentar buscar global (user_id is null)
        if (!settings) {
          console.log('[Nina] No user-specific settings, trying global...');
          const { data: globalSettings } = await supabase
            .from('nina_settings')
            .select('*')
            .is('user_id', null)
            .maybeSingle();
          settings = globalSettings;
          if (settings) {
            console.log('[Nina] Found global settings (user_id is null)');
          }
        }
        
        // 3. Último fallback: buscar qualquer settings existente
        if (!settings) {
          console.log('[Nina] No global settings, fetching any available...');
          const { data: anySettings } = await supabase
            .from('nina_settings')
            .select('*')
            .limit(1)
            .maybeSingle();
          settings = anySettings;
          if (settings) {
            console.log('[Nina] Using fallback settings from:', settings.id);
          }
        }

        // Use default settings if nothing found
        const effectiveSettings = settings || {
          is_active: true,
          auto_response_enabled: true,
          ai_model_mode: 'flash',
          response_delay_min: 1000,
          response_delay_max: 3000,
          message_breaking_enabled: false,
          audio_response_enabled: false,
          elevenlabs_api_key: null,
          ai_scheduling_enabled: true,
          user_id: conversation.user_id
        };
        
        if (!settings) {
          console.log('[Nina] No settings found in database, using hardcoded defaults');
        }

        // Check if Nina is active for this user
        if (!effectiveSettings.is_active) {
          console.log('[Nina] Nina is disabled for user:', conversation.user_id);
          await supabase
            .from('nina_processing_queue')
            .update({ 
              status: 'completed', 
              processed_at: new Date().toISOString(),
              error_message: 'Nina disabled for this user'
            })
            .eq('id', item.id);
          continue;
        }

        // Produção lê exclusivamente o ponteiro publicado do agente. O
        // armazenamento operacional legado continua contendo integrações e
        // preferências de modelo, mas nunca mais fornece o comportamento.
        const publishedAgent = await fetchPublishedAgentRuntimeConfig(
          supabase,
          conversation.user_id,
        );
        if (!publishedAgent) {
          console.error('[Nina] No published agent version for conversation workspace');
          await supabase
            .from('nina_processing_queue')
            .update({
              status: 'failed',
              processed_at: new Date().toISOString(),
              error_message: 'Nenhuma versão publicada da agente está disponível',
            })
            .eq('id', item.id);
          continue;
        }
        runtimeContext = publishedAgent;
        const systemPrompt = publishedAgent.compiledPrompt;
        
        console.log('[Nina] Processing with settings:', {
          is_active: effectiveSettings.is_active,
          auto_response_enabled: effectiveSettings.auto_response_enabled,
          ai_model_mode: effectiveSettings.ai_model_mode,
          has_compiled_prompt: true,
          agent_version_id: publishedAgent.versionId,
          agent_version_number: publishedAgent.versionNumber,
          has_whatsapp_config: !!effectiveSettings.whatsapp_phone_number_id,
          has_elevenlabs: !!effectiveSettings.elevenlabs_api_key,
        });
        
        await processQueueItem(supabase, lovableApiKey, item, systemPrompt, effectiveSettings, publishedAgent);
        
        // Mark as completed
        await supabase
          .from('nina_processing_queue')
          .update({ 
            status: 'completed', 
            processed_at: new Date().toISOString() 
          })
          .eq('id', item.id);
        
        processed++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Nina] Error processing item ${item.id}:`, error);

        if (runtimeContext) {
          const { error: eventError } = await supabase.from('agent_runtime_events').insert({
            workspace_id: runtimeContext.workspaceId,
            agent_id: runtimeContext.agentId,
            agent_version_id: runtimeContext.versionId,
            conversation_id: item.conversation_id || null,
            source_message_id: item.message_id || null,
            event_kind: 'error',
            compiler_version: runtimeContext.compilerVersion,
            route: 'orchestrator',
            error_code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
            metadata: {
              queue_item_id: item.id,
              retry_count: item.retry_count || 0,
              error_message: redactSensitiveText(errorMessage, 500),
            },
          });
          if (eventError) console.error('[Nina] Failed to persist runtime error event:', eventError);
        }
        
        // Mark as failed with retry
        const newRetryCount = (item.retry_count || 0) + 1;
        const shouldRetry = newRetryCount < 3;
        
        await supabase
          .from('nina_processing_queue')
          .update({ 
            status: shouldRetry ? 'pending' : 'failed',
            retry_count: newRetryCount,
            error_message: redactSensitiveText(errorMessage, 500),
            scheduled_for: shouldRetry 
              ? new Date(Date.now() + newRetryCount * 30000).toISOString() 
              : null
          })
          .eq('id', item.id);
      }
    }

    console.log(`[Nina] Processed ${processed}/${queueItems.length} messages`);

    return new Response(JSON.stringify({ processed, total: queueItems.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Nina] Orchestrator error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Generate audio using ElevenLabs
// Motivo da última falha de voz (TTS ou upload), gravado na mensagem do lead quando a
// resposta em áudio cai para texto — os logs da função só aparecem no painel.
let lastAudioError = '';

async function generateAudioElevenLabs(settings: any, text: string): Promise<ArrayBuffer | null> {
  if (!settings.elevenlabs_api_key) {
    console.log('[Nina] ElevenLabs API key not configured');
    lastAudioError = 'tts: sem chave do ElevenLabs';
    return null;
  }

  try {
    const voiceId = settings.elevenlabs_voice_id || '33B4UnXyTNbgLmdEDh5P'; // Keren - Young Brazilian Female
    const model = settings.elevenlabs_model || 'eleven_turbo_v2_5';

    console.log('[Nina] Generating audio with ElevenLabs, voice:', voiceId);

    const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': settings.elevenlabs_api_key,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: settings.elevenlabs_stability || 0.75,
          similarity_boost: settings.elevenlabs_similarity_boost || 0.80,
          style: settings.elevenlabs_style || 0.30,
          use_speaker_boost: settings.elevenlabs_speaker_boost !== false
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Nina] ElevenLabs error:', response.status, errorText);
      lastAudioError = `tts: HTTP ${response.status} ${errorText.slice(0, 220)}`;
      return null;
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.error('[Nina] Error generating audio:', error);
    lastAudioError = `tts: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  }
}

// Upload audio to Supabase Storage
async function uploadAudioToStorage(
  supabase: any, 
  audioBuffer: ArrayBuffer, 
  conversationId: string
): Promise<string | null> {
  try {
    const fileName = `${conversationId}/${Date.now()}.mp3`;
    
    const { data, error } = await supabase.storage
      .from('audio-messages')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/mpeg',
        cacheControl: '3600'
      });

    if (error) {
      console.error('[Nina] Error uploading audio:', error);
      lastAudioError = `upload: ${error.message ?? String(error)}`;
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('audio-messages')
      .getPublicUrl(fileName);

    console.log('[Nina] Audio uploaded:', urlData.publicUrl);
    return urlData.publicUrl;
  } catch (error) {
    console.error('[Nina] Error uploading audio to storage:', error);
    lastAudioError = `upload: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  }
}

/** Grava na mensagem do lead por que a resposta em áudio caiu para texto. */
async function recordAudioReplyError(supabase: any, message: any): Promise<void> {
  try {
    await supabase.from('messages')
      .update({ metadata: { ...(message?.metadata ?? {}), audio_reply_error: lastAudioError.slice(0, 300) } })
      .eq('id', message.id);
  } catch (error) {
    console.error('[Nina] Falha ao registrar erro de áudio:', error);
  }
}

// Create appointment from AI tool call
// Helper function to parse time string to minutes
function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

const ORGANIZER_BUSY_TITLE = 'Compromisso na agenda do responsável';

/**
 * Agenda real do organizador (Google, via service account). A checagem interna só
 * enxerga agendamentos da própria Nina; o freebusy pega reuniões marcadas por fora.
 * Best-effort: se a consulta falhar, não bloqueia (vale a checagem interna).
 */
async function isOrganizerBusy(date: string, time: string, durationMinutes: number): Promise<boolean> {
  if (!Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || !Deno.env.get('FABIANO_CALENDAR_EMAIL')) return false;
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return false;
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/google-calendar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'freebusy', date, time: String(time).slice(0, 5), duration: durationMinutes }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true) {
      console.warn('[Nina] freebusy indisponível — seguindo só com a checagem interna:', data?.error ?? response.status);
      return false;
    }
    return data.busy === true;
  } catch (error) {
    console.warn('[Nina] freebusy falhou — seguindo só com a checagem interna:', error);
    return false;
  }
}

async function checkAvailabilityFromAI(
  supabase: any,
  workspaceId: string,
  args: { date: string; time: string; duration?: number },
  excludedAppointmentId?: string,
): Promise<any> {
  let query = supabase
    .from('appointments')
    .select('id, time, duration, title')
    .eq('workspace_id', workspaceId)
    .eq('date', args.date)
    .eq('status', 'scheduled');
  if (excludedAppointmentId) query = query.neq('id', excludedAppointmentId);
  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  const requestedStart = parseTimeToMinutes(args.time);
  const requestedEnd = requestedStart + (args.duration || 60);
  const conflict = (data || []).find((existing: any) => {
    const existingStart = parseTimeToMinutes(String(existing.time).slice(0, 5));
    const existingEnd = existingStart + (existing.duration || 60);
    return requestedStart < existingEnd && requestedEnd > existingStart;
  });

  if (conflict) {
    return { success: true, available: false, conflict: { time: conflict.time, title: conflict.title } };
  }
  if (await isOrganizerBusy(args.date, args.time, args.duration || 60)) {
    return { success: true, available: false, conflict: { time: args.time, title: ORGANIZER_BUSY_TITLE } };
  }
  return { success: true, available: true, date: args.date, time: args.time, duration: args.duration || 60 };
}

async function runAuditedAction(
  supabase: any,
  context: {
    workspaceId: string;
    versionId: string | null;
    conversationId: string;
    contactId: string;
    sourceMessageId: string;
    actionKey: string;
    input: Record<string, unknown>;
  },
  execute: () => Promise<any>,
): Promise<any> {
  const idempotencyKey = `${context.sourceMessageId}:${context.actionKey}`;
  const { data: run, error: insertError } = await supabase
    .from('agent_action_runs')
    .insert({
      workspace_id: context.workspaceId,
      agent_version_id: context.versionId,
      conversation_id: context.conversationId,
      contact_id: context.contactId,
      source_message_id: context.sourceMessageId,
      action_key: context.actionKey,
      mode: 'live',
      idempotency_key: idempotencyKey,
      input: redactSensitiveValue(context.input),
    })
    .select('id')
    .single();

  if (insertError?.code === '23505') {
    const { data: existing } = await supabase
      .from('agent_action_runs')
      .select('status, output, error_code')
      .eq('workspace_id', context.workspaceId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing?.status === 'succeeded') return { ...existing.output, replayed: true };
    return {
      success: false,
      error: existing?.error_code || 'action_state_unknown',
      message: 'A ação já foi tentada nesta mensagem e não será repetida automaticamente.',
    };
  }
  if (insertError) return { success: false, error: insertError.message };

  try {
    await consumeRateLimit(supabase, {
      workspaceId: context.workspaceId,
      subjectKey: context.conversationId,
      operation: 'runtime_tool',
      maxRequests: 30,
      windowSeconds: 60,
    });
    const output = await execute();
    const succeeded = output?.success === true;
    await supabase
      .from('agent_action_runs')
      .update({
        status: succeeded ? 'succeeded' : 'failed',
        output: redactSensitiveValue(output),
        error_code: succeeded ? null : redactSensitiveText(String(output?.error || 'action_failed'), 160),
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.id);
    return output;
  } catch (error) {
    const message = error instanceof RateLimitError
      ? 'action_rate_limited'
      : redactSensitiveText(error instanceof Error ? error.message : 'action_failed', 160);
    await supabase
      .from('agent_action_runs')
      .update({ status: 'failed', error_code: message, finished_at: new Date().toISOString() })
      .eq('id', run.id);
    return { success: false, error: message };
  }
}

// Mantém o efeito da tool independente do provedor de agenda: o agendamento
// local sempre é concluído e a integração registra eventual erro para retry.
async function syncAppointmentToExternalCalendar(
  appointmentId: string,
  action: 'sync_event' | 'delete_event' = 'sync_event',
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return;
    // Agenda do Fabiano via service account (opt-in): com GOOGLE_SERVICE_ACCOUNT_JSON
    // + FABIANO_CALENDAR_EMAIL setados, o evento vai pra agenda DELE (organizador
    // real, sem ele conectar nada) em vez da conta conectada por Nylas — assim não
    // há convite duplicado. Sem essa config, segue pelo Nylas exatamente como antes.
    const useGoogle = !!Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') && !!Deno.env.get('FABIANO_CALENDAR_EMAIL');
    const fn = useGoogle ? 'google-calendar' : 'nylas-calendar';
    const response = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, appointmentId }),
    });
    if (!response.ok) {
      console.error(`[Nina] Calendar sync failed (${fn}):`, response.status, await response.text());
    }
  } catch (error) {
    console.error('[Nina] Calendar sync request failed:', error);
  }
}

async function createAppointmentFromAI(
  supabase: any,
  workspaceId: string,
  contactId: string,
  conversationId: string,
  sourceMessageId: string,
  userId: string | null,
  args: {
    title: string;
    date: string;
    time: string;
    duration?: number;
    type: 'demo' | 'meeting' | 'support' | 'followup';
    description?: string;
    bufferMinutes?: number;
  }
): Promise<any> {
  console.log('[Nina] Creating appointment from AI:', args, 'for user:', userId);
  
  // Validate date is not in the past
  const appointmentDate = new Date(`${args.date}T${args.time}:00`);
  const now = new Date();
  
  if (appointmentDate < now) {
    console.log('[Nina] Attempted to create appointment in the past, skipping');
    return { error: 'date_in_past' };
  }
  
  // Check for time conflicts (only for this user's appointments)
  const query = supabase
    .from('appointments')
    .select('id, time, duration, title')
    .eq('workspace_id', workspaceId)
    .eq('date', args.date)
    .eq('status', 'scheduled');
  
  if (userId) {
    query.eq('user_id', userId);
  }
  
  const { data: existingAppointments } = await query;
  
  const requestedStart = parseTimeToMinutes(args.time) - (args.bufferMinutes || 0);
  const requestedDuration = args.duration || 60;
  const requestedEnd = parseTimeToMinutes(args.time) + requestedDuration + (args.bufferMinutes || 0);
  
  for (const existing of existingAppointments || []) {
    const existingStart = parseTimeToMinutes(existing.time);
    const existingEnd = existingStart + (existing.duration || 60);
    
    // Check for overlap: new appointment starts before existing ends AND new appointment ends after existing starts
    if (requestedStart < existingEnd && requestedEnd > existingStart) {
      console.log('[Nina] Time conflict detected with appointment:', existing.id);
      return {
        error: 'time_conflict',
        conflictWith: existing.time,
        conflictTitle: existing.title
      };
    }
  }

  if (await isOrganizerBusy(args.date, args.time, requestedDuration)) {
    console.log('[Nina] Time conflict detected on organizer calendar');
    return { error: 'time_conflict', conflictWith: args.time, conflictTitle: ORGANIZER_BUSY_TITLE };
  }

  // Pacote de passagem (Passo 6.4): anexa a ficha ao agendamento para o Fabiano
  // entrar preparado. Leitura best-effort — falha aqui não impede o agendamento.
  let handoffPackage: string | null = null;
  let routing: unknown = null;
  let contactRow: any = null;
  let conversationRow: any = null;
  try {
    const [contactRes, conversationRes] = await Promise.all([
      supabase.from('contacts').select('name, call_name, phone_number, email, client_memory').eq('id', contactId).maybeSingle(),
      supabase.from('conversations').select('channel').eq('id', conversationId).maybeSingle(),
    ]);
    contactRow = contactRes.data;
    conversationRow = conversationRes.data;
    if (contactRow) {
      const pkg = buildHandoffPackage({ contact: contactRow, conversation: conversationRow || {}, memory: contactRow.client_memory });
      handoffPackage = pkg.markdown;
      routing = pkg.routing;
    }
  } catch (e) {
    console.error('[Nina] montar pacote de passagem no agendamento falhou:', e);
  }

  const insertData: any = {
    workspace_id: workspaceId,
    title: args.title,
    date: args.date,
    time: args.time,
    duration: args.duration || 60,
    type: args.type,
    description: args.description || handoffPackage || null,
    contact_id: contactId,
    status: 'scheduled',
    metadata: {
      source: 'nina_ai',
      conversation_id: conversationId,
      source_message_id: sourceMessageId,
      created_at_conversation: new Date().toISOString(),
      handoff_package: handoffPackage,
      routing,
    }
  };
  
  // Add user_id if available (for RLS compliance)
  if (userId) {
    insertData.user_id = userId;
  }
  
  const { data, error } = await supabase
    .from('appointments')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    console.error('[Nina] Error creating appointment:', error);
    return { error: error.message };
  }

  await syncAppointmentToExternalCalendar(data.id);
  console.log('[Nina] Appointment created successfully:', data.id);

  // Confirmação de reunião por WhatsApp (template utilitário aprovado — ex.:
  // lis_confirmaca_reuniao_v1). Opt-in por env CONFIRM_WA_TEMPLATE, e só quando a
  // conversa é WhatsApp e há telefone — numa conversa de e-mail a própria Lis já
  // confirma em texto. Best-effort (não derruba o agendamento).
  try {
    const confirmTemplate = (Deno.env.get('CONFIRM_WA_TEMPLATE') || '').trim();
    const phone = contactRow?.phone_number;
    if (confirmTemplate && phone && conversationRow?.channel !== 'email') {
      const nome = (contactRow?.call_name || contactRow?.name || '').trim() || 'tudo bem';
      const brDate = typeof args.date === 'string' ? args.date.split('-').reverse().join('/') : args.date;
      const hora = typeof args.time === 'string' ? args.time.slice(0, 5) : args.time;
      const quando = `${brDate} às ${hora}`;
      const spec = (Deno.env.get('CONFIRM_WA_PARAMS') || 'name,datetime').trim();
      const params = spec.split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean).map((k: string) => {
        if (k === 'name' || k === 'nome') return nome;
        if (k === 'datetime' || k === 'data') return quando;
        return k;
      });
      await enqueueTemplateForContact(supabase, {
        contact: { id: contactId, name: contactRow?.name ?? null, call_name: contactRow?.call_name ?? null, phone_number: phone },
        name: confirmTemplate,
        language: (Deno.env.get('CADENCE_WA_LANGUAGE') || 'pt_BR').trim(),
        bodyText: '',
        params,
      });
      const supabaseUrl2 = Deno.env.get('SUPABASE_URL')!;
      const serviceKey2 = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      fetch(`${supabaseUrl2}/functions/v1/whatsapp-sender`, {
        method: 'POST', headers: { Authorization: `Bearer ${serviceKey2}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by: 'appointment-confirmation' }),
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[Nina] confirmação de reunião por WhatsApp falhou:', e);
  }

  return { success: true, appointment: data };
}

// Reschedule an existing appointment
async function rescheduleAppointmentFromAI(
  supabase: any,
  workspaceId: string,
  contactId: string,
  userId: string | null,
  args: {
    new_date: string;
    new_time: string;
    reason?: string;
    bufferMinutes?: number;
  }
): Promise<any> {
  console.log('[Nina] Rescheduling appointment for contact:', contactId, 'user:', userId, args);
  
  // Find the most recent scheduled appointment for this contact
  const query = supabase
    .from('appointments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .eq('status', 'scheduled')
    .order('date', { ascending: true })
    .order('time', { ascending: true })
    .limit(1);
  
  if (userId) {
    query.eq('user_id', userId);
  }
  
  const { data: existingAppointments } = await query;
  
  if (!existingAppointments || existingAppointments.length === 0) {
    console.log('[Nina] No appointment found to reschedule');
    return { error: 'no_appointment_found' };
  }
  
  const appointment = existingAppointments[0];
  
  // Validate new date is not in the past
  const newAppointmentDate = new Date(`${args.new_date}T${args.new_time}:00`);
  const now = new Date();
  
  if (newAppointmentDate < now) {
    console.log('[Nina] Attempted to reschedule to a past date');
    return { error: 'date_in_past' };
  }
  
  // Check for conflicts at new time (only for this user's appointments)
  const conflictQuery = supabase
    .from('appointments')
    .select('id, time, duration, title')
    .eq('workspace_id', workspaceId)
    .eq('date', args.new_date)
    .eq('status', 'scheduled')
    .neq('id', appointment.id);
  
  if (userId) {
    conflictQuery.eq('user_id', userId);
  }
  
  const { data: conflictingAppointments } = await conflictQuery;
  
  const requestedStart = parseTimeToMinutes(args.new_time) - (args.bufferMinutes || 0);
  const requestedEnd = parseTimeToMinutes(args.new_time) + (appointment.duration || 60) + (args.bufferMinutes || 0);
  
  for (const existing of conflictingAppointments || []) {
    const existingStart = parseTimeToMinutes(existing.time);
    const existingEnd = existingStart + (existing.duration || 60);
    
    if (requestedStart < existingEnd && requestedEnd > existingStart) {
      console.log('[Nina] Time conflict detected at new time');
      return {
        error: 'time_conflict',
        conflictWith: existing.time,
        conflictTitle: existing.title
      };
    }
  }

  if (await isOrganizerBusy(args.new_date, args.new_time, appointment.duration || 60)) {
    console.log('[Nina] Time conflict detected on organizer calendar at new time');
    return { error: 'time_conflict', conflictWith: args.new_time, conflictTitle: ORGANIZER_BUSY_TITLE };
  }

  // Update the appointment
  const { data, error } = await supabase
    .from('appointments')
    .update({
      date: args.new_date,
      time: args.new_time,
      metadata: {
        ...appointment.metadata,
        rescheduled_at: new Date().toISOString(),
        rescheduled_reason: args.reason || null,
        previous_date: appointment.date,
        previous_time: appointment.time
      }
    })
    .eq('id', appointment.id)
    .select()
    .single();
  
  if (error) {
    console.error('[Nina] Error rescheduling appointment:', error);
    return { error: error.message };
  }

  await syncAppointmentToExternalCalendar(data.id);
  console.log('[Nina] Appointment rescheduled successfully:', data.id);
  return { success: true, appointment: { ...data, previous_date: appointment.date, previous_time: appointment.time } };
}

// Cancel an existing appointment
async function cancelAppointmentFromAI(
  supabase: any,
  workspaceId: string,
  contactId: string,
  userId: string | null,
  args: {
    reason?: string;
  }
): Promise<any> {
  console.log('[Nina] Canceling appointment for contact:', contactId, 'user:', userId);
  
  // Find the most recent scheduled appointment for this contact
  const query = supabase
    .from('appointments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .eq('status', 'scheduled')
    .order('date', { ascending: true })
    .order('time', { ascending: true })
    .limit(1);
  
  if (userId) {
    query.eq('user_id', userId);
  }
  
  const { data: existingAppointments } = await query;
  
  if (!existingAppointments || existingAppointments.length === 0) {
    console.log('[Nina] No appointment found to cancel');
    return { error: 'no_appointment_found' };
  }
  
  const appointment = existingAppointments[0];
  
  // Update status to cancelled
  const { data, error } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      metadata: {
        ...appointment.metadata,
        cancelled_at: new Date().toISOString(),
        cancelled_reason: args.reason || null,
        cancelled_by: 'nina_ai'
      }
    })
    .eq('id', appointment.id)
    .select()
    .single();
  
  if (error) {
    console.error('[Nina] Error canceling appointment:', error);
    return { error: error.message };
  }

  await syncAppointmentToExternalCalendar(data.id, 'delete_event');
  console.log('[Nina] Appointment cancelled successfully:', data.id);
  return { success: true, appointment: data };
}

async function handoffConversationFromAI(
  supabase: any,
  workspaceId: string,
  conversation: any,
  args: { reason: string; summary: string },
): Promise<any> {
  // Pacote de passagem (Passo 6.4) + roteamento (Passo 6.3), montado do que já
  // está no CRM, para a equipe assumir sem repetir pergunta que a Lis já fez.
  const pkg = buildHandoffPackage({
    contact: conversation.contact,
    conversation,
    memory: conversation.contact?.client_memory,
  });
  const { data, error } = await supabase
    .from('conversations')
    .update({
      status: 'human',
      metadata: {
        ...(conversation.metadata || {}),
        handoff: {
          workspace_id: workspaceId,
          reason: args.reason,
          summary: args.summary,
          package: pkg.markdown,
          routing: pkg.routing,
          requested_at: new Date().toISOString(),
          requested_by: 'nina_ai',
        },
      },
    })
    .eq('id', conversation.id)
    .select('id, status')
    .single();
  if (error) return { success: false, error: error.message };
  const memory = conversation.contact?.client_memory && typeof conversation.contact.client_memory === 'object'
    ? conversation.contact.client_memory
    : {};
  const leadState = memory.lead_state && typeof memory.lead_state === 'object' ? memory.lead_state : {};
  const { error: memoryError } = await supabase
    .from('contacts')
    .update({
      client_memory: {
        ...memory,
        lead_state: {
          ...leadState,
          handoff_requested: true,
          conversation_summary: args.summary || leadState.conversation_summary || '',
          handoff_package: pkg.markdown,
          routing: pkg.routing,
        },
      },
    })
    .eq('id', conversation.contact_id);
  if (memoryError) return { success: false, error: memoryError.message };
  return { success: true, handoff: data, reason: args.reason, routing: pkg.routing };
}

/**
 * Resposta por e-mail: a Lis responde pelo canal de e-mail (email-send) em vez da
 * fila do WhatsApp. Assunto e threading vêm do último e-mail do lead (gravados em
 * conversations.metadata pelo email-inbound). Prioritário: resposta a lead fura o
 * rate limit, como no envio prioritário do enviar.py.
 */
// deno-lint-ignore no-explicit-any
async function sendEmailReply(supabase: any, conversation: any, _message: any, aiContent: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const to = conversation.contact?.email;
  if (!to) { console.error('[Nina] resposta por e-mail sem endereço do contato'); return; }
  const meta = conversation.metadata && typeof conversation.metadata === 'object' ? conversation.metadata : {};
  const base = typeof meta.last_email_subject === 'string' && meta.last_email_subject ? meta.last_email_subject : 'nossa conversa';
  const subject = /^re:/i.test(base) ? base : `Re: ${base}`;
  const inReplyTo = typeof meta.last_email_message_id === 'string' ? meta.last_email_message_id : null;
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/email-send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, text: aiContent, conversationId: conversation.id, inReplyTo, priority: true }),
    });
    if (!resp.ok) console.error('[Nina] email-send falhou:', resp.status, await resp.text().catch(() => ''));
    else console.log('[Nina] resposta enviada por e-mail para', to);
  } catch (err) {
    console.error('[Nina] erro ao enviar resposta por e-mail:', err);
  }
}

/**
 * Alerta de escalada (playbook Passo 7.x — "quando a Lis não sabe responder").
 * Quando a conversa é transferida para humano (human_handoff), avisa o time
 * responsável (a Elisandra no piloto) por e-mail interno, com o contexto do lead.
 * Canal: e-mail interno via email-send (modo internal) — não depende de template
 * da Meta e já está pronto. Destinatários em ESCALATION_ALERT_EMAILS (lista
 * separada por vírgula). A conversa é marcada como já alertada para não repetir.
 */
// deno-lint-ignore no-explicit-any
async function notifyEscalation(
  supabase: any,
  conversation: any,
  args: { reason?: string; summary?: string },
): Promise<void> {
  const recipients = (Deno.env.get('ESCALATION_ALERT_EMAILS') || Deno.env.get('ESCALATION_ALERT_EMAIL') || '')
    .split(',').map((s) => s.trim()).filter((s) => s.includes('@'));
  if (recipients.length === 0) {
    console.log('[Nina] handoff sem ESCALATION_ALERT_EMAILS configurado — alerta não enviado');
    return;
  }

  // Lê a metadata FRESCA (o handoff acabou de gravar metadata.handoff; a cópia em
  // memória é anterior). Evita (a) re-alertar a mesma escalada e (b) sobrescrever
  // o que o handoff gravou.
  const { data: fresh } = await supabase
    .from('conversations').select('metadata').eq('id', conversation.id).maybeSingle();
  const meta = fresh?.metadata && typeof fresh.metadata === 'object' ? fresh.metadata : {};
  const escalation = meta.escalation && typeof meta.escalation === 'object' ? meta.escalation : null;
  if (escalation?.alerted_at) return;

  const contact = conversation.contact || {};
  const memory = contact.client_memory && typeof contact.client_memory === 'object' ? contact.client_memory : {};
  const apollo = memory.apollo && typeof memory.apollo === 'object' ? memory.apollo : {};
  const nome = contact.name || contact.call_name || contact.phone_number || contact.email || 'Lead sem nome';
  const empresa = apollo.company || '';
  const contato = [contact.phone_number, contact.email].filter(Boolean).join(' · ') || '—';
  const motivo = args.reason || '—';

  // Pacote de passagem completo (Passo 6.4) — a ficha que o time recebe.
  const pkg = buildHandoffPackage({ contact, conversation, memory });

  const subject = `🔔 A Lis precisa de você — ${nome}${empresa ? ` (${empresa})` : ''}`;
  const text = [
    'A Lis transferiu uma conversa para atendimento humano.',
    '',
    `Motivo: ${motivo}`,
    `Contato: ${contato}`,
    '',
    pkg.markdown,
    '',
    'Abra a aba "Chat ao vivo" da Nina para assumir. A conversa está marcada como atendimento humano e a cadência foi pausada.',
  ].join('\n');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resp = await fetch(`${supabaseUrl}/functions/v1/email-send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ internal: true, to: recipients, subject, text }),
    });
    if (!resp.ok) console.error('[Nina] alerta de escalada falhou:', resp.status, await resp.text().catch(() => ''));
    else console.log('[Nina] alerta de escalada enviado para', recipients.join(', '));
  } catch (err) {
    console.error('[Nina] erro ao enviar alerta de escalada:', err);
  }

  // Marca como alertada preservando o resto da metadata (inclusive o handoff).
  const { error } = await supabase.from('conversations').update({
    metadata: { ...meta, escalation: { ...(escalation || {}), alerted_at: new Date().toISOString(), recipients } },
  }).eq('id', conversation.id);
  if (error) console.error('[Nina] marcar escalada alertada falhou:', error.message ?? error);
}

async function processQueueItem(
  supabase: any,
  lovableApiKey: string,
  item: any,
  systemPrompt: string,
  settings: any,
  runtimeAgent: PublishedAgentRuntimeConfig
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  console.log(`[Nina] Processing queue item: ${item.id}`);

  // Get the message
  const { data: message } = await supabase
    .from('messages')
    .select('*')
    .eq('id', item.message_id)
    .maybeSingle();

  if (!message) {
    throw new Error('Message not found');
  }

  // Get conversation with contact info
  const { data: conversation } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', item.conversation_id)
    .maybeSingle();

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Check if conversation is still in Nina mode
  if (conversation.status !== 'nina') {
    console.log('[Nina] Conversation no longer in Nina mode, skipping');
    return;
  }

  // Check if auto-response is enabled
  if (!settings?.auto_response_enabled) {
    console.log('[Nina] Auto-response disabled, marking as processed without responding');
    await supabase
      .from('messages')
      .update({ processed_by_nina: true })
      .eq('id', message.id);
    return;
  }

  // Get recent messages for context (last 20)
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversation.id)
    .order('sent_at', { ascending: false })
    .limit(20);

  // Build conversation history for AI. Áudio do lead chega já transcrito: a marcação
  // diz à Lis que ela "ouviu" — sem isso ela tomava o texto por digitado e respondia
  // que não consegue ouvir áudio.
  const conversationHistory = (recentMessages || [])
    .reverse()
    .map((msg: any) => {
      const content = msg.content || '[media]';
      const transcribedAudio = msg.from_type === 'user' && msg.type === 'audio'
        && !content.startsWith('[O lead enviou um áudio') && content !== '[áudio - processando transcrição...]';
      return {
        role: msg.from_type === 'user' ? 'user' : 'assistant',
        content: transcribedAudio ? `[áudio transcrito] ${content}` : content,
      };
    });

  // Get client memory
  const clientMemory = conversation.contact?.client_memory || {};

  // Build enhanced system prompt with context
  const enhancedSystemPrompt = buildEnhancedPrompt(
    systemPrompt, 
    conversation.contact, 
    clientMemory
  );

  // Process template variables ({{ data_hora }}, {{ dia_semana }}, etc.)
  const processedPrompt = processPromptTemplate(enhancedSystemPrompt, conversation.contact);

  console.log('[Nina] Calling Lovable AI (agent loop)...');

  // Get AI model settings based on user configuration
  const aiSettings = getModelSettings(settings, conversationHistory, message, conversation.contact, clientMemory);

  console.log('[Nina] Using AI settings:', aiSettings);

  // Grounding anti-alucinação: fatos canônicos + regras de verdade no prompt
  if (!runtimeAgent) throw new Error('Published agent context not available');
  const facts = await fetchCanonicalFacts(supabase, runtimeAgent.workspaceId);
  const groundedPrompt = processedPrompt + buildGroundingSection(facts);

  // A versão publicada é a autoridade das ações. Flags legadas não podem
  // habilitar uma ferramenta que o snapshot publicado desabilitou.
  const appointmentPolicy = getActionPolicy(runtimeAgent?.config, 'appointments');
  const handoffPolicy = getActionPolicy(runtimeAgent?.config, 'human_handoff');
  const extraTools: any[] = [registerOptOutTool, registerConsentTool, registerReferralTool, shareChecklistTool];
  if (appointmentPolicy) extraTools.push(checkAvailabilityTool, createAppointmentTool, rescheduleAppointmentTool, cancelAppointmentTool);
  if (handoffPolicy) extraTools.push(humanHandoffTool);

  let appointmentCreated: any = null;
  // Args do handoff capturados no handler, usados depois para o alerta de escalada.
  let handoffArgs: { reason?: string; summary?: string } | null = null;

  const agentResult = await runNinaAgent({
    supabase,
    lovableApiKey,
    provider: aiSettings.provider,
    apiKeys: {
      anthropic: settings?.anthropic_api_key ?? null,
      openai: settings?.openai_api_key ?? null,
    },
    model: aiSettings.model,
    temperature: aiSettings.temperature,
    systemPrompt: groundedPrompt,
    history: conversationHistory,
    extraTools,
    conversationId: conversation.id,
    contactId: conversation.contact_id,
    workspaceId: runtimeAgent.workspaceId,
    executeExtraTool: async (name: string, args: any) => {
      const audit = (actionKey: string, execute: () => Promise<any>) => runAuditedAction(
        supabase,
        {
          workspaceId: runtimeAgent!.workspaceId,
          versionId: runtimeAgent!.versionId,
          conversationId: conversation.id,
          contactId: conversation.contact_id,
          sourceMessageId: message.id,
          actionKey,
          input: args,
        },
        execute,
      );

      if (name === 'check_availability' && appointmentPolicy && runtimeAgent) {
        const validation = validateScheduleRequest(args, appointmentPolicy);
        if (!validation.ok) return { result: { success: false, error: validation.code }, ok: false, summary: validation.code };
        const result = await audit(name, () => checkAvailabilityFromAI(
          supabase, runtimeAgent.workspaceId, {
            date: args.date,
            time: args.time,
            duration: args.duration || (appointmentPolicy.scheduling as any)?.durationMinutes,
          },
        ));
        return { result, ok: result.success === true, summary: result.available ? 'available' : 'time_conflict' };
      }

      // Ação benigna (só devolve texto): tratada antes do portão de confirmação.
      if (name === 'share_checklist') {
        const result = await audit(name, async () => {
          const mem = conversation.contact?.client_memory && typeof conversation.contact.client_memory === 'object'
            ? conversation.contact.client_memory
            : {};
          const apollo = mem.apollo && typeof mem.apollo === 'object' ? mem.apollo : {};
          // Fonte de verdade: persona do CRM (Apollo). Fallbacks: deriva pelo cargo,
          // depois a dica do agente; por fim P1 (persona principal do playbook).
          let persona: 'P1' | 'P3' | null =
            apollo.persona === 'P1' || apollo.persona === 'P3' ? apollo.persona : null;
          if (!persona) persona = derivePersona(apollo.title ?? null, apollo.seniority ?? null);
          if (!persona && (args.persona_hint === 'P1' || args.persona_hint === 'P3')) persona = args.persona_hint;
          if (!persona) persona = 'P1';
          const text = persona === 'P3' ? CHECKLIST_P3 : CHECKLIST_P1;
          return {
            success: true,
            persona,
            checklist_text: text,
            instruction: 'Envie este checklist ao lead exatamente como está, com as 5 perguntas na íntegra, sem reescrever nem resumir. Você pode acrescentar uma frase curta antes ou depois.',
          };
        });
        return { result, ok: result.success === true, summary: result.success ? `checklist_${result.persona}` : 'checklist_error' };
      }

      const confirmed = hasExplicitConfirmation(conversationHistory, args.confirmation_evidence);
      if (!confirmed) {
        return {
          result: { success: false, error: 'explicit_confirmation_required', message: 'Peça ao lead para confirmar explicitamente antes de executar.' },
          ok: false,
          summary: 'explicit_confirmation_required',
        };
      }

      if (name === 'register_referral') {
        const result = await audit(name, async () => {
          const referredName = typeof args.referred_name === 'string' ? args.referred_name.trim() : '';
          if (!referredName) return { success: false, error: 'referred_name_required' };
          const referredEmail = typeof args.referred_email === 'string' ? args.referred_email.trim() : '';
          const referredPhone = typeof args.referred_phone === 'string' ? args.referred_phone.trim() : '';
          const referredRole = typeof args.referred_role === 'string' ? args.referred_role.trim() : '';
          const now = new Date().toISOString();
          const curMem = conversation.contact?.client_memory && typeof conversation.contact.client_memory === 'object' ? conversation.contact.client_memory : {};
          const apollo = curMem.apollo && typeof curMem.apollo === 'object' ? curMem.apollo : {};
          const companyName = typeof apollo.company === 'string' && apollo.company ? apollo.company : null;
          const referrerName = conversation.contact?.name || conversation.contact?.call_name || null;

          // 1) Registra a indicação na memória do contato atual (auditoria).
          const referrals = Array.isArray(curMem.referrals) ? curMem.referrals : [];
          await supabase.from('contacts').update({
            client_memory: { ...curMem, referrals: [...referrals, { name: referredName, role: referredRole || null, email: referredEmail || null, phone: referredPhone || null, at: now }] },
          }).eq('id', conversation.contact_id);

          // 2) Com e-mail ou telefone, cria/atualiza o contato indicado, marcado como
          //    'referral' (não entra na cadência fria — o time dá o toque de indicação).
          let newContactId: string | null = null;
          if (referredEmail || referredPhone) {
            newContactId = await upsertUnifiedContact(supabase, {
              email: referredEmail || null,
              phone: referredPhone || null,
              fullName: referredName,
              title: referredRole || null,
              companyName,
              origin: 'referral',
            });
            if (newContactId) {
              const { data: created } = await supabase.from('contacts').select('tags, client_memory, notes').eq('id', newContactId).maybeSingle();
              const tags = Array.isArray(created?.tags) ? created.tags : [];
              const mem2 = created?.client_memory && typeof created.client_memory === 'object' ? created.client_memory : {};
              await supabase.from('contacts').update({
                tags: Array.from(new Set([...tags, 'referral'])),
                client_memory: { ...mem2, referred_by: { contact_id: conversation.contact_id, name: referrerName, at: now } },
                notes: created?.notes || `Indicado por ${referrerName || 'um contato'}`,
              }).eq('id', newContactId);
            }
          }
          return { success: true, referred: referredName, new_contact_id: newContactId, needs_human_followup: !newContactId };
        });
        return { result, ok: result.success === true, summary: result.error || 'referral_registered' };
      }

      if (name === 'register_opt_out') {
        if (!runtimeAgent) return { result: { success: false, error: 'agent_not_published' }, ok: false };
        const result = await audit(name, async () => {
          const now = new Date().toISOString();
          const currentTags = Array.isArray(conversation.contact?.tags) ? conversation.contact.tags : [];
          const memory = conversation.contact?.client_memory && typeof conversation.contact.client_memory === 'object'
            ? conversation.contact.client_memory
            : {};
          const leadState = memory.lead_state && typeof memory.lead_state === 'object' ? memory.lead_state : {};
          const { error: contactError } = await supabase
            .from('contacts')
            .update({
              tags: Array.from(new Set([...currentTags, 'opt_out'])),
              client_memory: {
                ...memory,
                opt_out: true,
                opt_out_at: now,
                opt_out_reason: args.reason || null,
                lead_state: { ...leadState, opt_out: true },
              },
            })
            .eq('id', conversation.contact_id);
          if (contactError) return { success: false, error: contactError.message };
          const { error: conversationError } = await supabase
            .from('conversations')
            .update({ status: 'paused' })
            .eq('id', conversation.id);
          if (conversationError) return { success: false, error: conversationError.message };
          return { success: true, status: 'paused', registered_at: now };
        });
        return { result, ok: result.success === true, summary: result.error || 'opt_out_registered' };
      }

      if (name === 'register_consent') {
        if (!runtimeAgent) return { result: { success: false, error: 'agent_not_published' }, ok: false };
        const result = await audit(name, async () => {
          const now = new Date().toISOString();
          const currentTags = Array.isArray(conversation.contact?.tags) ? conversation.contact.tags : [];
          const memory = conversation.contact?.client_memory && typeof conversation.contact.client_memory === 'object'
            ? conversation.contact.client_memory
            : {};
          const leadState = memory.lead_state && typeof memory.lead_state === 'object' ? memory.lead_state : {};
          const granted = args.granted === true;
          const consent = {
            granted,
            channel: typeof args.channel === 'string' && args.channel ? args.channel : null,
            lead_quote: typeof args.lead_quote === 'string' ? args.lead_quote.slice(0, 1000) : null,
            request_text: typeof args.request_text === 'string' ? args.request_text.slice(0, 1000) : null,
            at: now,
          };
          // "Não" ao pedido de autorização = supressão imediata (playbook 5.5).
          const suppress = !granted;
          const nextTags = Array.from(new Set([
            ...currentTags.filter((tag: string) => tag !== 'consent_yes' && tag !== 'consent_no'),
            granted ? 'consent_yes' : 'consent_no',
            ...(suppress ? ['opt_out'] : []),
          ]));
          const { error: contactError } = await supabase
            .from('contacts')
            .update({
              tags: nextTags,
              client_memory: {
                ...memory,
                consent,
                ...(suppress ? { opt_out: true, opt_out_at: now, opt_out_reason: 'negou autorização de comunicação' } : {}),
                lead_state: {
                  ...leadState,
                  consent: { value: granted ? 'concedido' : 'negado', status: 'confirmed' },
                  ...(suppress ? { opt_out: true } : {}),
                },
              },
            })
            .eq('id', conversation.contact_id);
          if (contactError) return { success: false, error: contactError.message };
          if (suppress) {
            const { error: conversationError } = await supabase
              .from('conversations')
              .update({ status: 'paused' })
              .eq('id', conversation.id);
            if (conversationError) return { success: false, error: conversationError.message };
          }
          return { success: true, granted, suppressed: suppress, registered_at: now };
        });
        return {
          result,
          ok: result.success === true,
          summary: result.error || (result.granted ? 'consent_granted' : 'consent_denied'),
        };
      }

      if (name === 'create_appointment') {
        if (!appointmentPolicy || !runtimeAgent) return { result: { success: false, error: 'action_not_enabled' }, ok: false };
        const validation = validateScheduleRequest(args, appointmentPolicy);
        if (!validation.ok) return { result: { success: false, error: validation.code }, ok: false, summary: validation.code };
        // LGPD + playbook (6.4): nunca agendar sem o consentimento registrado.
        // O lead pode ter autorizado na fala, mas precisa estar no CRM antes —
        // a Lis grava com register_consent e só então agenda.
        const apptMemory = conversation.contact?.client_memory && typeof conversation.contact.client_memory === 'object'
          ? conversation.contact.client_memory
          : {};
        if (apptMemory?.consent?.granted !== true) {
          return {
            result: { success: false, error: 'consent_required', message: 'Registre o consentimento do lead com register_consent antes de agendar.' },
            ok: false,
            summary: 'consent_required',
          };
        }
        const result = await audit(name, () => createAppointmentFromAI(
          supabase,
          runtimeAgent.workspaceId,
          conversation.contact_id,
          conversation.id,
          message.id,
          settings?.user_id || null,
          {
            ...args,
            duration: args.duration || (appointmentPolicy.scheduling as any)?.durationMinutes,
            bufferMinutes: (appointmentPolicy.scheduling as any)?.bufferMinutes || 0,
          },
        ));
        appointmentCreated = result.success ? result.appointment : null;
        return {
          result,
          ok: result.success === true,
          summary: result.error || 'appointment_created',
        };
      }
      if (name === 'reschedule_appointment') {
        if (!appointmentPolicy || !runtimeAgent) return { result: { success: false, error: 'action_not_enabled' }, ok: false };
        const validation = validateScheduleRequest({ date: args.new_date, time: args.new_time }, appointmentPolicy);
        if (!validation.ok) return { result: { success: false, error: validation.code }, ok: false, summary: validation.code };
        const result = await audit(name, () => rescheduleAppointmentFromAI(
          supabase,
          runtimeAgent.workspaceId,
          conversation.contact_id,
          settings?.user_id || null,
          { ...args, bufferMinutes: (appointmentPolicy.scheduling as any)?.bufferMinutes || 0 },
        ));
        return { result, ok: result.success === true, summary: result.error || 'appointment_rescheduled' };
      }
      if (name === 'cancel_appointment') {
        if (!appointmentPolicy || !runtimeAgent) return { result: { success: false, error: 'action_not_enabled' }, ok: false };
        const result = await audit(name, () => cancelAppointmentFromAI(
          supabase, runtimeAgent.workspaceId, conversation.contact_id, settings?.user_id || null, args
        ));
        return { result, ok: result.success === true, summary: result.error || 'appointment_cancelled' };
      }
      if (name === 'human_handoff') {
        if (!handoffPolicy || !runtimeAgent) return { result: { success: false, error: 'action_not_enabled' }, ok: false };
        const result = await audit(name, () => handoffConversationFromAI(
          supabase, runtimeAgent.workspaceId, conversation, args
        ));
        if (result.success === true) handoffArgs = { reason: args.reason, summary: args.summary };
        return { result, ok: result.success === true, summary: result.error || 'human_handoff_completed' };
      }
      return { result: { erro: `Ferramenta desconhecida: ${name}` }, ok: false };
    },
  });

  let aiContent = agentResult.content;
  const grounding = agentResult.grounding;

  console.log('[Nina] Agent finished:', {
    iterations: agentResult.iterations,
    searches: grounding.searches.length,
    unanswered: grounding.unanswered.length,
    tool_events: grounding.tool_events.length,
  });

  // O que EFETIVAMENTE respondeu (o fallback pode ter trocado provedor/modelo)
  const effectiveAi = {
    provider: agentResult.usedProvider,
    model: agentResult.usedModel,
    fallback: agentResult.usedFallback,
  };
  if (agentResult.usedFallback) {
    console.warn(`[Nina] Provedor ${aiSettings.provider} falhou — resposta veio do fallback ${effectiveAi.provider}/${effectiveAi.model}`);
  }

  // Fallback for empty AI response - use default greeting instead of throwing error.
  // Se o motor degradou APÓS criar um agendamento real, confirma o agendamento
  // em vez de responder algo genérico (e nunca relança — relançar reprocessaria
  // o item da fila e duplicaria o efeito).
  if (!aiContent) {
    console.warn('[Nina] Empty AI response received (degraded:', agentResult.degraded, '), using fallback');
    if (appointmentCreated && !appointmentCreated.error) {
      const brDate = typeof appointmentCreated.date === 'string'
        ? appointmentCreated.date.split('-').reverse().join('/')
        : null;
      const shortTime = typeof appointmentCreated.time === 'string'
        ? appointmentCreated.time.slice(0, 5)
        : null;
      const when = [brDate, shortTime].filter(Boolean).join(' às ');
      aiContent = when
        ? `Prontinho! Seu agendamento ficou confirmado para ${when}. Qualquer coisa é só me chamar por aqui.`
        : 'Prontinho! Seu agendamento está confirmado. Qualquer coisa é só me chamar por aqui.';
    } else {
      aiContent = 'Certo! Como posso ajudar?';
    }
  }

  console.log('[Nina] Final response length:', aiContent.length);

  // Calculate response time
  const responseTime = Date.now() - new Date(message.sent_at).getTime();

  // Update original message as processed
  await supabase
    .from('messages')
    .update({ 
      processed_by_nina: true,
      nina_response_time: responseTime
    })
    .eq('id', message.id);

  const toolSummaries = grounding.tool_events.map((event: any) => ({
    tool: event.tool,
    ok: event.ok === true,
    summary: event.summary || null,
  }));
  const sourceSummaries = grounding.searches.flatMap((search: any) => (
    (search.results || []).map((source: any) => ({
      query: search.query,
      source_type: source.source_type,
      title: source.title,
      rank: source.rank,
    }))
  ));
  const handoffObserved = toolSummaries.some((event: any) => event.tool === 'human_handoff' && event.ok);
  const guards = [
    ...(grounding.unanswered.length > 0 ? ['unknown_answer_policy'] : []),
    ...(toolSummaries.some((event: any) => event.summary === 'explicit_confirmation_required') ? ['explicit_confirmation_required'] : []),
    ...(toolSummaries.some((event: any) => event.tool === 'register_opt_out' && event.ok) ? ['opt_out'] : []),
  ];
  const { error: runtimeEventError } = await supabase.from('agent_runtime_events').insert({
    workspace_id: runtimeAgent.workspaceId,
    agent_id: runtimeAgent.agentId,
    agent_version_id: runtimeAgent.versionId,
    conversation_id: conversation.id,
    contact_id: conversation.contact_id,
    source_message_id: message.id,
    event_kind: handoffObserved ? 'handoff' : 'response',
    compiler_version: runtimeAgent.compilerVersion,
    model_provider: effectiveAi.provider,
    model_name: effectiveAi.model,
    route: toolSummaries[0]?.tool || 'conversation',
    sources: sourceSummaries,
    tools: toolSummaries,
    guards,
    latency_ms: responseTime,
    handoff: handoffObserved,
    metadata: {
      used_fallback: effectiveAi.fallback,
      iterations: agentResult.iterations,
      unanswered_count: grounding.unanswered.length,
      response_characters: aiContent.length,
    },
  });
  if (runtimeEventError) console.error('[Nina] Failed to persist runtime observability:', runtimeEventError);

  // Alerta de escalada: a Lis transferiu para humano → avisa o time (Elisandra no
  // piloto). Não bloqueia a resposta ao lead; roda em background quando o runtime
  // suporta, senão aguarda (é rápido e a escalada é rara).
  if (handoffObserved) {
    const escalationTask = notifyEscalation(supabase, conversation, handoffArgs || {});
    if ((globalThis as any).EdgeRuntime?.waitUntil) {
      (globalThis as any).EdgeRuntime.waitUntil(escalationTask);
    } else {
      await escalationTask.catch((e) => console.error('[Nina] alerta de escalada:', e));
    }
  }

  // Add response delay if configured
  const delayMin = settings?.response_delay_min || 1000;
  const delayMax = settings?.response_delay_max || 3000;
  const delay = Math.random() * (delayMax - delayMin) + delayMin;

  // E-mail: a Lis responde pelo canal de e-mail (email-send). Guardado por channel
  // para o caminho WhatsApp (áudio + send_queue + whatsapp-sender) seguir idêntico.
  if (conversation.channel === 'email') {
    await sendEmailReply(supabase, conversation, message, aiContent);
  } else {

  // Check if audio response should be sent - pure mirroring: only respond with audio if incoming was audio
  const incomingWasAudio = message.type === 'audio';
  const shouldSendAudio = incomingWasAudio && settings?.elevenlabs_api_key;

  if (shouldSendAudio) {
    console.log(`[Nina] Audio response enabled (incoming was audio: ${incomingWasAudio})`);
    
    const audioBuffer = await generateAudioElevenLabs(settings, aiContent);
    
    if (audioBuffer) {
      const audioUrl = await uploadAudioToStorage(supabase, audioBuffer, conversation.id);
      
      if (audioUrl) {
        const { error: sendQueueError } = await supabase
          .from('send_queue')
          .insert({
            conversation_id: conversation.id,
            contact_id: conversation.contact_id,
            content: aiContent,
            from_type: 'nina',
            message_type: 'audio',
            media_url: audioUrl,
            priority: 1,
            scheduled_at: new Date(Date.now() + delay).toISOString(),
            metadata: {
              response_to_message_id: message.id,
              ai_model: effectiveAi.model,
              ai_provider: effectiveAi.provider,
              ai_fallback: effectiveAi.fallback,
              audio_generated: true,
              text_content: aiContent,
              appointment_created: appointmentCreated?.id || null,
              grounding: grounding || null
            }
          });

        if (sendQueueError) {
          console.error('[Nina] Error queuing audio response:', sendQueueError);
          throw sendQueueError;
        }

        console.log('[Nina] Audio response queued for sending');
      } else {
        console.log('[Nina] Failed to upload audio, falling back to text');
        await recordAudioReplyError(supabase, message);
        await queueTextResponse(supabase, conversation, message, aiContent, settings, effectiveAi, delay, appointmentCreated, grounding);
      }
    } else {
      console.log('[Nina] Failed to generate audio, falling back to text');
      await recordAudioReplyError(supabase, message);
      await queueTextResponse(supabase, conversation, message, aiContent, settings, effectiveAi, delay, appointmentCreated, grounding);
    }
  } else {
    await queueTextResponse(supabase, conversation, message, aiContent, settings, effectiveAi, delay, appointmentCreated, grounding);
  }

  // Trigger whatsapp-sender
  try {
    const senderUrl = `${supabaseUrl}/functions/v1/whatsapp-sender`;
    console.log('[Nina] Triggering whatsapp-sender at:', senderUrl);
    
    fetch(senderUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ triggered_by: 'nina-orchestrator' })
    }).catch(err => console.error('[Nina] Error triggering whatsapp-sender:', err));
  } catch (err) {
    console.error('[Nina] Failed to trigger whatsapp-sender:', err);
  }
  } // fim do ramo WhatsApp (conversation.channel !== 'email')

  // Trigger analyze-conversation
  fetch(`${supabaseUrl}/functions/v1/analyze-conversation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseServiceKey}`
    },
    body: JSON.stringify({
      contact_id: conversation.contact_id,
      conversation_id: conversation.id,
      user_message: message.content,
      ai_response: aiContent,
    })
  }).catch(err => console.error('[Nina] Error triggering analyze-conversation:', err));
}

// Helper function to queue text response with chunking
async function queueTextResponse(
  supabase: any,
  conversation: any,
  message: any,
  aiContent: string,
  settings: any,
  aiSettings: any,
  delay: number,
  appointmentCreated?: any,
  grounding?: any
) {
  // Break message into chunks if enabled
  const messageChunks = settings?.message_breaking_enabled 
    ? breakMessageIntoChunks(aiContent)
    : [aiContent];

  console.log(`[Nina] Sending ${messageChunks.length} text message chunk(s)`);

  // Queue each chunk for sending
  for (let i = 0; i < messageChunks.length; i++) {
    const chunkDelay = delay + (i * 1500);
    
    const { error: sendQueueError } = await supabase
      .from('send_queue')
      .insert({
        conversation_id: conversation.id,
        contact_id: conversation.contact_id,
        content: messageChunks[i],
        from_type: 'nina',
        message_type: 'text',
        priority: 1,
        scheduled_at: new Date(Date.now() + chunkDelay).toISOString(),
        metadata: {
          response_to_message_id: message.id,
          ai_model: aiSettings.model,
          ai_provider: aiSettings.provider,
          ai_fallback: aiSettings.fallback ?? false,
          chunk_index: i,
          total_chunks: messageChunks.length,
          appointment_created: appointmentCreated?.id || null,
          grounding: i === 0 ? (grounding || null) : null
        }
      });

    if (sendQueueError) {
      console.error('[Nina] Error queuing response chunk:', sendQueueError);
      throw sendQueueError;
    }
  }

  console.log('[Nina] Text response(s) queued for sending');
}


function breakMessageIntoChunks(content: string): string[] {
  const chunks = content
    .split(/\n\n+/)
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.length > 0);
  
  return chunks.length > 0 ? chunks : [content];
}

function getModelSettings(
  settings: any,
  conversationHistory: any[],
  message: any,
  contact: any,
  clientMemory: any
): { provider: 'lovable' | 'anthropic' | 'openai'; model: string; temperature: number } {
  const resolved = resolveModelSettings(settings);
  if (!resolved.adaptive) {
    return { provider: resolved.provider, model: resolved.model, temperature: resolved.temperature };
  }
  // Adaptativo: a heurística escolhe o TIER; o modelo vem do provedor configurado.
  const adaptive = getAdaptiveTier(conversationHistory, message, clientMemory);
  return {
    provider: resolved.provider,
    model: modelForTier(resolved.provider, adaptive.tier),
    temperature: adaptive.temperature,
  };
}

function getAdaptiveTier(
  conversationHistory: any[],
  message: any,
  clientMemory: any
): { tier: 'low' | 'medium' | 'high'; temperature: number } {
  const messageCount = conversationHistory.length;
  const userContent = message.content?.toLowerCase() || '';

  const isComplaintKeywords = ['problema', 'erro', 'não funciona', 'reclamação', 'péssimo', 'horrível'];
  const isSalesKeywords = ['preço', 'valor', 'desconto', 'comprar', 'contratar', 'plano'];
  const isTechnicalKeywords = ['como funciona', 'integração', 'api', 'configurar', 'instalar'];
  const isUrgentKeywords = ['urgente', 'agora', 'rápido', 'emergência'];

  const isComplaint = isComplaintKeywords.some(k => userContent.includes(k));
  const isSales = isSalesKeywords.some(k => userContent.includes(k));
  const isTechnical = isTechnicalKeywords.some(k => userContent.includes(k));
  const isUrgent = isUrgentKeywords.some(k => userContent.includes(k));

  const qualificationScore = clientMemory?.lead_profile?.qualification_score || 0;

  // Semântica herdada do adaptativo original: alterna entre a classe padrão
  // (medium) e a mais cognitiva (high) — nunca rebaixa a abertura do funil
  // para o tier mais barato.
  if (isComplaint || isUrgent) return { tier: 'high', temperature: 0.3 };
  if (isSales && qualificationScore > 50) return { tier: 'medium', temperature: 0.5 };
  if (isTechnical) return { tier: 'high', temperature: 0.4 };
  if (messageCount < 5) return { tier: 'medium', temperature: 0.8 };
  if (messageCount > 15) return { tier: 'medium', temperature: 0.5 };
  return { tier: 'medium', temperature: 0.7 };
}
