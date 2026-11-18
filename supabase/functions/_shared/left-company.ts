// "Não trabalho mais na empresa" (ajuste do Fabiano para o lote 2, 18/11/2026): a resposta
// é classificada como "Mudou de cargo ou empresa" e o lead é encerrado — cadência cancelada,
// classificação gravada no painel do Piloto (lead_outcomes), negócio em "Perdido" e conversa
// pausada (o time vê no painel; a Lis não continua a conversa sozinha).
//
// Duas portas: a ferramenta register_left_company do nina-orchestrator (o modelo reconhece
// paráfrases) e a rede de segurança por texto abaixo, que o orquestrador aplica quando o
// modelo não chamou a ferramenta. No lote 1 um lead respondeu "Não trabalho
// mais nessa empresa" e ficou como "Respondeu, em conversa" em "Novos Leads".

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export const LEFT_COMPANY_REASON = 'Mudou de cargo ou empresa';

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// Frases curtas e específicas (sem acento, minúsculas). "Não trabalho mais com isso"
// não casa: exige referência à empresa/lugar depois de "não trabalho mais".
const PATTERNS: RegExp[] = [
  /\bnao (trabalho|atuo|estou) mais (na|nessa|nesta|naquela|no|nesse|neste|com voces|ai|la|aqui|pela|pelo|para|pra)\b/,
  /\bnao faco mais parte (da|do|dessa|desta|desse|deste)\b/,
  /\bnao pertenco mais\b/,
  /\bnao sou mais (funcionari[oa]|colaborador[a]?|diretor[a]?|socio|socia|da|do)\b/,
  /\b(sai|me desliguei|fui desligad[oa]) (da|do|dessa|desta|desse|deste) (empresa|companhia|grupo)\b/,
  /\bdeixei a (empresa|companhia)\b/,
  /\bja sai (da|do|dessa|desta)\b/,
];

/** A mensagem do lead diz que ele não trabalha mais na empresa? */
export function saysLeftCompany(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = normalize(text);
  return PATTERNS.some((re) => re.test(t));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Encerra o lead como "Mudou de cargo ou empresa". Idempotente. Não sobrescreve um motivo
 * de perda já marcado à mão no painel.
 */
export async function closeLeftCompany(
  supabase: SupabaseClient,
  args: { contactId: string; conversationId?: string | null; quote?: string | null },
): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString();
  const { data: contact, error: readError } = await supabase
    .from('contacts')
    .select('tags, client_memory')
    .eq('id', args.contactId)
    .maybeSingle();
  if (readError || !contact) return { success: false, error: readError?.message ?? 'contato não encontrado' };

  const tags: string[] = Array.isArray(contact.tags) ? contact.tags : [];
  const mem = record(contact.client_memory);
  const leadState = record(mem.lead_state);
  const { error: contactError } = await supabase.from('contacts').update({
    tags: Array.from(new Set([...tags, 'replied', 'mudou_empresa'])),
    client_memory: {
      ...mem,
      replied_at: mem.replied_at ?? now,
      left_company: { at: now, quote: args.quote ?? null },
      lead_state: { ...leadState, left_company: true },
    },
  }).eq('id', args.contactId);
  if (contactError) return { success: false, error: contactError.message };

  // Nada mais da cadência sai para ele.
  await supabase.from('cadence_state').update({ status: 'cancelled', last_error: LEFT_COMPANY_REASON })
    .eq('contact_id', args.contactId).in('status', ['pending', 'sending']);

  // Classificação do painel do Piloto (respeita o que o time já marcou).
  const { data: outcome } = await supabase
    .from('lead_outcomes').select('reply_type, loss_reason').eq('contact_id', args.contactId).maybeSingle();
  if (!outcome?.loss_reason) {
    const { error } = await supabase.from('lead_outcomes').upsert({
      contact_id: args.contactId,
      reply_type: outcome?.reply_type ?? 'neutra',
      loss_reason: LEFT_COMPANY_REASON,
      updated_by: null,
      updated_at: now,
    }, { onConflict: 'contact_id' });
    if (error) console.error('[left-company] lead_outcomes', error.message ?? error);
  }

  // Negócio em "Perdido".
  const { data: lost } = await supabase
    .from('pipeline_stages').select('id, title').ilike('title', 'perdido').limit(1).maybeSingle();
  if (lost?.id) {
    const { error } = await supabase.from('deals')
      .update({ stage_id: lost.id, stage: lost.title, lost_reason: LEFT_COMPANY_REASON, lost_at: now })
      .eq('contact_id', args.contactId)
      .is('won_at', null);
    if (error) console.error('[left-company] deals', error.message ?? error);
  }

  if (args.conversationId) {
    await supabase.from('conversations').update({ status: 'paused' }).eq('id', args.conversationId);
  }
  return { success: true };
}
