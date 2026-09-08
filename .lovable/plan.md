# Disparos — motor de campanhas em massa por WhatsApp

Nova aba lateral "Disparos", trazendo o motor de disparo do projeto de origem (campanhas, perfis de velocidade, pausar/retomar, progresso ao vivo) adaptado ao envio já existente aqui: templates aprovados da Meta, enfileirados no mesmo caminho de envio do app.

## O que o usuário vai ver

Nova entrada "Disparos" na barra lateral, entre Contatos e Agendamentos, com três blocos:

1. **Resumo** — enviadas, taxa de entrega, campanhas em andamento, perfis criados.
2. **Campanhas** — lista com status (rascunho, enviando, pausada, concluída, falha), barra de progresso ao vivo, botões pausar/retomar/cancelar e uma tela de detalhes com a lista de destinatários e o motivo de cada falha.
3. **Perfis de velocidade** — criar/editar/excluir perfis com intervalo entre mensagens, tamanho do lote e pausa entre lotes; cada perfil mostra a estimativa de mensagens por dia. Um perfil pode ser marcado como padrão.

### Assistente de nova campanha (4 passos)

1. Nome da campanha.
2. Template aprovado (lista vinda da Meta, só os aprovados) + preenchimento das variáveis, aceitando valores fixos ou campos do contato (nome, telefone).
3. Destinatários: contatos do CRM com filtro por tags e por etapa do funil; prévia da contagem; contatos bloqueados ou sem telefone são descartados com aviso.
4. Ritmo: escolha do perfil de velocidade (ou ajuste manual) + prévia da mensagem e resumo antes de confirmar o disparo.

Importação por planilha fica de fora — a origem dos contatos será estendida depois (Apollo).

## Como funciona por dentro

**Banco (nova migração, com GRANTs e RLS por workspace/usuário como nas tabelas atuais):**
- `dispatch_profiles` — nome, descrição, `delay_min_s`, `delay_max_s`, `batch_size`, `pause_between_batches_min/max`, `is_default`.
- `broadcast_campaigns` — nome, `template_name`, `template_language`, `template_body`, `template_params` (tokens), parâmetros de ritmo copiados do perfil no momento da criação, `status`, `total_recipients`, `sent_count`, `failed_count`, `next_batch_at` (também usado como trava de concorrência), timestamps.
- `broadcast_recipients` — campanha, `contact_id`, telefone, variáveis resolvidas, `status` (pending/sent/failed), `error_message`, `sent_at`.
- Índices em `(campaign_id, status)` e `(status)`.

**Edge function `broadcast-processor`** — porte do arquivo do projeto de origem, com estas mudanças:
- envio: em vez de `send-meta-message`, cada destinatário reaproveita a rotina de `whatsapp-template-send` (cria/acha a conversa, grava a mensagem no histórico e insere em `send_queue` com `message_type = 'template'` e `metadata.template`), depois dispara o `whatsapp-sender`. A lógica compartilhada vai para `supabase/functions/_shared/template-dispatch.ts`, usada pelas duas funções.
- mantém: trava atômica via `next_batch_at`, processamento por lote, atraso aleatório entre mensagens, pausa entre lotes, auto-reinvocação, corte por tempo de execução, checagem de pausa a cada 5 envios, conclusão automática.
- remove: rotação de instâncias, spintax, mídia, áudio/ElevenLabs, fluxos — não se aplicam ao envio por template desta base.
- valida JWT e exige papel admin/editor para iniciar, pausar ou retomar.

**Frontend:** `src/pages/Dispatch.tsx` (+ componentes em `src/components/broadcasts/`), hooks `useBroadcasts` e `useDispatchProfiles` sobre react-query com atualização em tempo real das campanhas, serviço `src/services/broadcasts.ts`, rota `/dispatch` protegida e item novo no `Sidebar`. Visual segue os tokens e o estilo das páginas atuais (`operation-page`), não o CSS do projeto de origem.

## Fora do escopo

Importação CSV/Apollo, texto livre e mídia, áudio com voz, rotação de múltiplas instâncias.
