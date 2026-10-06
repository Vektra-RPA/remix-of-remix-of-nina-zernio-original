// Conteúdo aprovado do Playbook SDR Virtual – Indústrias v2.2 (Fabiano, 21/09/2026)
// para carregar na base de conhecimento da Lis (Épico E). As descrições de oferta,
// os casos (Anexo B) e os checklists (Passo 5.3) saem daqui — da base aprovada,
// não da imaginação da Lis. É carregado pela tela Conhecimento (seedPlaybookKnowledge),
// que passa pela ingestão real (dedup + indexação), não por SQL cru.

export interface SeedFact {
  title: string;
  category: 'faq' | 'geral' | 'política';
  question?: string;
  fact: string;
  always_include?: boolean;
}

export interface SeedDocument {
  title: string;
  content: string;
}

export const PLAYBOOK_SOURCE = 'Playbook SDR Virtual – Indústrias v2.2 (aprovado em 21/09/2026)';

// Perguntas frequentes + descrições aprovadas (Passo 2 e Passo 5.4).
export const PLAYBOOK_FACTS: SeedFact[] = [
  {
    title: 'O que a Trajetória faz (curso de IA + SCALE)',
    category: 'faq',
    question: 'O que vocês fazem?',
    fact:
      'A Trajetória trabalha em duas frentes. A SCALE é a consultoria que revisa, padroniza e documenta os processos para a empresa usar automações e escalar — entrega a visão atual, o plano de melhorias e a implementação, inclusive das automações. O Curso de IA (16 horas, turmas de até 10 pessoas) capacita o time a tirar o melhor dos diferentes tipos de IA e a desenhar e construir agentes para problemas rotineiros, com segurança e LGPD. Use no máximo 3 frases e volte à pergunta original.',
  },
  {
    title: 'Curso de IA — descrição aprovada',
    category: 'faq',
    question: 'O que é o curso de IA?',
    fact:
      'Curso de IA (16 horas, turmas de até 10 pessoas). Ensina as diferenças entre os tipos de LLM e como tirar o melhor de cada um, apresenta aplicações de outros tipos de IA e ensina a desenhar um PRD e uma SPEC para construir um agente que resolve problemas rotineiros sem depender de terceiros, respeitando as regras de segurança e a LGPD.',
  },
  {
    title: 'SCALE — descrição aprovada',
    category: 'faq',
    question: 'O que é a SCALE?',
    fact:
      'SCALE: consultoria para empresas que precisam ter os processos revisados, padronizados e documentados para usar automações e escalar o negócio. Entregamos a visão atual, o plano de melhorias e a implementação dos processos que sustentam isso, ajudamos o cliente a escolher por onde começar e também implementamos as automações.',
  },
  {
    title: 'Quando oferecer o curso (segunda oferta)',
    category: 'geral',
    fact:
      'O curso entra como SEGUNDA oferta: para quem diz que o time precisa aprender a usar IA, para RH e Treinamento, e para clientes de SCALE que precisam capacitar a liderança. A primeira conversa é sempre sobre o problema do lead; curso e SCALE aparecem como parte da solução depois que a dor é reconhecida.',
  },
  {
    title: 'Preço — a Lis não informa',
    category: 'política',
    question: 'Quanto custa?',
    fact:
      'A Lis não informa preço. O investimento depende do escopo. Proponha uma conversa de até 30 minutos com o Fabiano para entender o cenário da empresa antes de falar de valores.',
    always_include: true,
  },
  {
    title: 'Pedido de mais informações',
    category: 'faq',
    question: 'Pode mandar mais informações?',
    fact:
      'Só depois da autorização registrada: envie a página de uma folha do caso da persona (Caso P1 ou P3) e faça uma única pergunta — "Hoje, isso é uma dor na sua empresa?". Nunca envie link ou anexo no primeiro contato.',
  },
  {
    title: 'Lead já usa IA ou já tem consultoria',
    category: 'faq',
    question: 'Já usamos IA / já temos consultoria',
    fact:
      'Pergunte com curiosidade antes de qualquer proposta: "Onde vocês usam hoje?" ou "O que a consultoria cobre?". Siga a resposta do lead antes de apresentar curso ou SCALE.',
  },
  {
    title: 'Origem do contato / transparência',
    category: 'faq',
    question: 'Quem é você? Como conseguiu meu contato?',
    fact:
      'Responda com transparência: você é a Lis, da Trajetória Consultoria, e o contato veio de uma base profissional pública. Ofereça o descadastro imediato e não insista.',
  },
];

// Materiais indexados (chunked): casos do Anexo B e checklists do Passo 5.3.
export const PLAYBOOK_DOCUMENTS: SeedDocument[] = [
  {
    title: 'Caso P1 — o dono deixou de ser o gargalo de compras e pagamentos',
    content:
      'Caso P1 · Como o dono de uma indústria deixou de ser o gargalo das compras e dos pagamentos.\n\n' +
      'Situação. O dono não liberava ordens de compra e pagamentos com tranquilidade. Não tinha visão do que já estava comprometido no mês contra o que podia gastar, e também desconfiava se o comprador estava fechando o melhor negócio possível.\n\n' +
      'O que foi feito. Uma IA passou a cruzar cada pedido com a previsão de caixa, o histórico anterior de compras e o orçamento anual.\n\n' +
      'Como funciona hoje. O dono só entra no fluxo quando algum requisito está fora do planejado.\n\n' +
      'Resultado. Melhoraram o tempo de aquisição, a assertividade das compras e a autonomia da equipe.\n\n' +
      'Uso: caso anônimo e autorizado. Diga "uma indústria", sem citar setor nem cliente. Sem números além do que está descrito aqui.',
  },
  {
    title: 'Caso P3 — o fechamento mensal ficou 4 dias mais curto',
    content:
      'Caso P3 · Como o fechamento mensal de uma indústria ficou 4 dias mais curto.\n\n' +
      'Situação. O fechamento dependia da entrada das notas fiscais de fornecedores, que chegavam na maioria no fim do mês.\n\n' +
      'O que foi feito. Um RPA passou a buscar nos portais as notas emitidas, validar com as ordens de compra em aberto e dar entrada automática no sistema.\n\n' +
      'Resultado. O tempo de fechamento caiu 4 dias, com a garantia de que todas as notas fiscais são incluídas.\n\n' +
      'Uso: caso anônimo e autorizado. Diga "uma indústria", sem citar setor nem cliente. O único número autorizado é "4 dias".',
  },
  {
    title: 'Checklist P1 — as decisões da sua indústria dependem demais de você?',
    content:
      'Checklist P1 · Cinco perguntas para saber se as decisões da sua indústria dependem demais de você.\n\n' +
      '1. Você sabe, neste momento, quanto já está comprometido em compras e pagamentos no mês contra o que a empresa pode gastar?\n' +
      '2. Alguma ordem de compra ou pagamento fica esperando a sua aprovação porque falta informação para decidir?\n' +
      '3. Você confia que as compras estão sendo fechadas pelo melhor negócio possível, ou aprova sem conseguir conferir?\n' +
      '4. A precificação de produtos novos passa por você? Existe uma regra clara ou depende de conversa caso a caso?\n' +
      '5. Se você ficasse uma semana sem aprovar nada, o que pararia primeiro?\n\n' +
      'Como ler: se você respondeu "não sei", "depende de mim" ou "fica parado" em três ou mais, há um gargalo de informação e de regra, não de pessoas. É o tipo de problema que uma conversa de 30 minutos ajuda a mapear.',
  },
  {
    title: 'Checklist P3 — cinco rotinas manuais que atrasam o fechamento',
    content:
      'Checklist P3 · Cinco rotinas manuais que atrasam o fechamento da indústria.\n\n' +
      '1. As notas fiscais dos fornecedores só entram no sistema perto do fim do mês?\n' +
      '2. Alguém confere manualmente as notas emitidas contra as ordens de compra em aberto?\n' +
      '3. As baixas de inventário ficam pendentes na virada do mês?\n' +
      '4. As conciliações são feitas à mão ou só depois do fechamento?\n' +
      '5. Existe alguma etapa do fechamento que só uma pessoa sabe fazer?\n\n' +
      'Como ler: cada "sim" é uma rotina candidata a automação. Três ou mais indicam que o prazo do fechamento está sendo definido pelo trabalho manual e não pela complexidade da empresa.',
  },
];
