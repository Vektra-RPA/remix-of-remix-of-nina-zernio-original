# Leads Apollo — captação semanal + disparo automático

Nova aba lateral "Leads" que busca 80 contatos por semana na Apollo (indústrias de 50 a 500 funcionários em SP, RS, SC e PR; cargos CEO e diretores), guarda tudo numa base própria e joga automaticamente quem tem telefone para uma campanha de disparo.

## A tela de Leads

Três partes:

1. **Resumo da semana** — leads trazidos, quantos têm telefone, quantos entraram em disparo, quantos responderam, próxima busca agendada e um botão "Buscar agora".
2. **Lista de leads** com busca por nome/empresa e filtros por estado, cargo, situação e "tem telefone". Cada linha mostra: nome, cargo, empresa, porte, cidade/estado, e-mail, telefone (ou "sem telefone"), prioridade e situação.
3. **Ficha do lead** (painel lateral ao clicar) — dados completos da pessoa e da empresa, link do LinkedIn, histórico do que aconteceu, conversa vinculada no CRM (quando existir) e os botões de classificação.

### Situação do lead

Como a classificação acontece depois do contato, a situação acompanha a conversa:

`Novo` → `Em disparo` → `Entregue` → `Respondeu` → e aí você marca `Qualificado`, `Sem interesse` ou `Descartado`. Também existe `Sem telefone` para quem só tem e-mail.

As três primeiras mudam sozinhas (envio, entrega e resposta detectada pelo WhatsApp). A qualificação final é sua, com campo de motivo/observação. Um lead qualificado pode virar negócio no funil com um clique.

Além disso, cada lead recebe uma **prioridade automática** (alta/média/baixa) calculada por cargo, porte da empresa e qualidade do contato — serve só para ordenar a fila, não substitui sua classificação.

### Configuração da busca

Um painel dentro da própria tela permite ajustar cargos, estados, faixa de funcionários, setor, quantidade semanal (padrão 80), o template aprovado usado no disparo automático e o perfil de velocidade. Assim os critérios não ficam presos no código.

## Como funciona por dentro

**Banco (nova migração, com GRANTs e RLS no padrão atual):**
- `apollo_leads` — `apollo_person_id` único (evita repetir lead), nome, cargo, senioridade, e-mail e status do e-mail, telefone, LinkedIn, empresa (nome, domínio, setor, nº de funcionários, cidade/UF), `priority_score`, `score_reasons`, `status`, `disqualify_reason`, `notes`, `contact_id`, `campaign_id`, `raw` (jsonb), `fetched_at`.
- `apollo_search_runs` — registro de cada execução: início/fim, `status` (running/success/failed/paused), quantidade pedida/trazida/nova, erro, e `locked_until` como trava de execução única.
- `apollo_search_settings` — critérios editáveis + template e perfil de disparo padrão.
- Índices em `apollo_person_id`, `status` e `fetched_at`.

**Edge function `apollo-lead-sync`** (chamada pelo agendador semanal e pelo botão manual):
- trava de execução única via `apollo_search_runs.locked_until`; sai se já houver uma rodando ou se estiver pausada por erro de crédito/permissão.
- busca paginada em `POST /api/v1/mixed_people/api_search` com os filtros salvos, limite rígido de páginas e de 80 leads novos por rodada.
- descarta IDs já existentes antes de enriquecer (economiza crédito Apollo).
- enriquece cada lead novo com `POST /api/v1/people/match` (`reveal_phone_number`) em lotes pequenos, respeitando 429 com espera e parando de vez em 401/403.
- calcula a prioridade, grava o lead, cria/atualiza o contato no CRM com a etiqueta `apollo` e, para quem tem celular, adiciona à campanha de disparo da semana (template e ritmo padrão configurados), reaproveitando `broadcast_campaigns`/`broadcast_recipients` e o `broadcast-processor` já existentes. Sem telefone → fica só na lista, marcado `Sem telefone`.
- toda chamada Apollo passa pelo gateway (`APOLLO_API_KEY` + `LOVABLE_API_KEY`), nunca pelo navegador; erros do provedor são gravados na rodada e mostrados na tela.

**Agendamento:** `pg_cron` semanal (segunda-feira 09:00 BRT) chamando a função. Uma vez por semana, sem custo de verificação contínua; se falhar, a rodada fica marcada como falha e a próxima tentativa é na semana seguinte ou pelo botão manual.

**Retorno de status:** ao gravar entrega/resposta, os destinatários de campanha já vinculados atualizam a situação do lead (em disparo → entregue → respondeu).

**Frontend:** `src/pages/Leads.tsx` + componentes em `src/components/leads/` (resumo, tabela, ficha lateral, painel de critérios), hook `useApolloLeads`, serviço `src/services/apolloLeads.ts`, rota `/leads` protegida e item "Leads" na barra lateral, acima de Disparos. Visual segue os tokens e o estilo das páginas atuais.

## Fora do escopo

Envio de e-mail (só WhatsApp por enquanto), enriquecimento de e-mails pessoais, exportação CSV e busca de empresas fora do Brasil.
