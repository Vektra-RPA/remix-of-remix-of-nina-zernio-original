# Promover amandayohana2303@gmail.com a administradora com edição do agente

## Situação atual (verificada)

- A conta `amandayohana2303@gmail.com` existe e **já tem o papel de administradora da plataforma**.
- Porém, ela **não pertence a nenhum espaço de trabalho** e, hoje, **não existe nenhum espaço de trabalho criado** no projeto (remix novo).
- A edição do agente depende de ser membro ativo de um espaço de trabalho com permissão de editar/publicar. É isso que está faltando — não o papel de administradora.

## O que será feito

1. Criar o espaço de trabalho principal do projeto (nome: "Trajetória Consultoria", ajustável).
2. Adicionar a Amanda como membra **administradora ativa** desse espaço, com permissão de **publicar o agente** ligada.
3. Criar o agente inicial e seu rascunho de configuração padrão, para que a tela de Configurações → Agente já abra pronta para edição em vez de vazia.
4. Manter/confirmar o papel de administradora da plataforma que ela já possui.
5. Conferir depois que a conta aparece como administradora com permissão de publicar e que o agente tem rascunho editável.

## Detalhes técnicos

- Nada de mudança de esquema: apenas inserções de dados via SQL.
  - `INSERT` em `public.workspaces` (status `active`, `created_by` = id da usuária).
  - `INSERT` em `public.workspace_members` com `role = 'admin'`, `can_publish_agent = true`, `status = 'active'`.
  - `INSERT` em `public.agents` + `public.agent_drafts` com a configuração padrão (`schemaVersion: 1`), espelhando o que a função `bootstrap_agent_workspace` faz — assim o resultado é idêntico ao caminho normal da aplicação.
  - Garantir a linha em `public.user_roles` com `role = 'admin'` (já existe; `ON CONFLICT DO NOTHING`).
- Nenhuma alteração em código da aplicação é necessária.

## Observação

Se preferir usar outro nome para o espaço de trabalho, é só dizer antes da aprovação.
