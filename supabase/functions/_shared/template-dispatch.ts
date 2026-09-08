/**
 * Enfileiramento de um template aprovado para um contato.
 *
 * Extraído do whatsapp-template-send para que o broadcast-processor use
 * exatamente o mesmo caminho de envio: conversa + histórico + send_queue com
 * `message_type = 'template'` e a spec em `metadata.template`, que o
 * whatsapp-sender já sabe traduzir para a Graph API.
 */

import { renderTemplateText } from './whatsapp-templates.ts';

export interface DispatchContact {
  id: string;
  name: string | null;
  call_name: string | null;
  phone_number: string | null;
  is_blocked?: boolean | null;
}

/** Tokens aceitos nas variáveis: valor fixo ou campo do contato. */
export function resolveParam(token: string, contact: DispatchContact): string {
  switch (token) {
    case '{{contact.name}}':
      return (contact.call_name || contact.name || '').trim();
    case '{{contact.phone}}':
      return (contact.phone_number || '').trim();
    default:
      return token;
  }
}

export interface EnqueueTemplateInput {
  contact: DispatchContact;
  name: string;
  language: string;
  bodyText: string;
  /** Tokens brutos — resolvidos por contato aqui dentro. */
  params: string[];
}

/**
 * Cria (ou reaproveita) a conversa, grava a mensagem e enfileira o envio.
 * Retorna o texto renderizado. Lança em qualquer falha de banco.
 */
// deno-lint-ignore no-explicit-any
export async function enqueueTemplateForContact(service: any, input: EnqueueTemplateInput): Promise<string> {
  const { contact, name, language, bodyText } = input;
  const bodyParams = input.params.map((token) => resolveParam(token, contact));
  const rendered = bodyText ? renderTemplateText(bodyText, bodyParams) : `[template] ${name}`;

  const { data: existing, error: conversationError } = await service
    .from('conversations')
    .select('id')
    .eq('contact_id', contact.id)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conversationError) throw conversationError;

  let conversationId = (existing as { id: string } | null)?.id ?? null;
  if (!conversationId) {
    const { data: created, error: createError } = await service
      .from('conversations')
      .insert({ contact_id: contact.id, status: 'human' })
      .select('id')
      .single();
    if (createError) throw createError;
    conversationId = (created as { id: string }).id;
  }

  const { data: messageRow, error: messageError } = await service
    .from('messages')
    .insert({
      conversation_id: conversationId,
      content: rendered,
      type: 'text',
      from_type: 'human',
      status: 'processing',
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (messageError) throw messageError;

  const { error: queueError } = await service.from('send_queue').insert({
    conversation_id: conversationId,
    contact_id: contact.id,
    content: rendered,
    from_type: 'human',
    message_type: 'template',
    priority: 2,
    message_id: (messageRow as { id: string }).id,
    metadata: { template: { name, language, bodyParams } },
  });
  if (queueError) throw queueError;

  return rendered;
}
