// Templates aprovados da cadência — lote 2 (ajustes do Fabiano, 18/11/2026).
// Copy verbatim aprovada pelo Fabiano — NÃO gerar por LLM: cadência fria usa texto aprovado.
//
// Remetente: os e-mails saem em nome do Fabiano (CADENCE_EMAIL_FROM_NAME); a Lis aparece
// só no WhatsApp, como assistente dele. O rodapé de descadastro faz parte do texto do D0 (o
// worker pede ao email-send para não anexar o rodapé padrão) e os e-mails do D7 e do D14
// vão sem rodapé, como respostas no mesmo fio ("Re:").

export type CadencePersona = 'P1' | 'P3';

export interface CadenceStepDef {
  step: number;
  tipo: string;
  channel: 'email' | 'whatsapp';
  offsetDays: number;
  // `enabled:false` tira o step da matrícula. Os números de step são estáveis (o histórico
  // do lote 1 usa 1–5): o step 4 (WhatsApp do D9) saiu da sequência no lote 2.
  enabled: boolean;
}

export const CADENCE_STEPS: CadenceStepDef[] = [
  { step: 1, tipo: 'abertura',  channel: 'email',    offsetDays: 0,  enabled: true },
  { step: 2, tipo: 'followup1', channel: 'whatsapp', offsetDays: 3,  enabled: true },
  { step: 3, tipo: 'followup2', channel: 'email',    offsetDays: 7,  enabled: true },
  { step: 4, tipo: 'followup3', channel: 'whatsapp', offsetDays: 9,  enabled: false },
  { step: 5, tipo: 'breakup',   channel: 'email',    offsetDays: 14, enabled: true },
];

export const ENABLED_STEPS = CADENCE_STEPS.filter((s) => s.enabled);

/** Último toque da sequência: nada sai depois dele. */
export const FINAL_STEP = Math.max(...ENABLED_STEPS.map((s) => s.step));

const SIGNATURE =
  'Fabiano Souza\n' +
  'Sócio · Trajetória Consultoria · Curitiba\n' +
  'linkedin.com/in/fabiano-souza-';

export const UNSUBSCRIBE_LINE = 'Para não receber mais e-mails meus, responda "parar".';

const SUBJECT: Record<CadencePersona, string> = {
  P1: 'aprovações na {empresa}',
  P3: 'fechamento na {empresa}',
};

/** Tema do toque de WhatsApp ({{2}} do template) e do e-mail de encerramento. */
const TEMA: Record<CadencePersona, { tema: string; temaCurto: string }> = {
  P1: { tema: 'as aprovações de compra e pagamento na {empresa}', temaCurto: 'as aprovações' },
  P3: { tema: 'o fechamento do mês na {empresa}', temaCurto: 'o fechamento' },
};

const BREAKUP =
  '{nome}, não vou insistir.\n\n' +
  'Se {tema_curto} virar prioridade na {empresa}, é só responder este e-mail. Chega direto em mim.\n\n' +
  'Abraço,\n' +
  'Fabiano';

// Steps 3 e 5 seguem o mesmo fio do step 1 ("Re: <assunto do D0>").
const TEMPLATES: Record<CadencePersona, Record<number, string>> = {
  P1: {
    1:
      '{nome}, sou o Fabiano Souza, conselheiro e consultor de indústrias de médio porte no PR e em SP.\n\n' +
      'Nas indústrias que acompanho, é comum o dono aprovar compra e pagamento um a um. Não por desconfiança: ele não enxerga o que já está comprometido no mês.\n\n' +
      'Na {empresa}, isso ainda passa por você?\n\n' +
      `${SIGNATURE}\n\n` +
      UNSUBSCRIBE_LINE,
    3:
      '{nome}, um exemplo concreto.\n\n' +
      'Numa indústria que acompanhamos, o dono aprovava cada compra porque não via o comprometido do mês contra o orçamento. Colocamos uma IA cruzando cada pedido com a previsão de caixa, o histórico de compras e o orçamento anual. Hoje ele só entra quando algo foge do planejado.\n\n' +
      'Quer que eu te mande o resumo em uma página?\n\n' +
      'Fabiano',
    5: BREAKUP,
  },
  P3: {
    1:
      '{nome}, sou o Fabiano Souza, conselheiro e consultor de indústrias de médio porte no PR e em SP.\n\n' +
      'O ponto em que mais vejo diretoria decidindo com número velho é o fechamento do mês.\n\n' +
      'Hoje a {empresa} fecha em que dia útil?\n\n' +
      `${SIGNATURE}\n\n` +
      UNSUBSCRIBE_LINE,
    3:
      '{nome}, um exemplo concreto.\n\n' +
      'Numa indústria que acompanhamos, automatizamos o lançamento das notas fiscais com robôs (RPA). O fechamento mensal ficou 4 dias mais curto.\n\n' +
      'Quer que eu te mande o resumo em uma página?\n\n' +
      'Fabiano',
    5: BREAKUP,
  },
};

// Toque de WhatsApp do D3 (Lis, assistente do Fabiano) como template Meta em pt_BR:
// {{1}} = primeiro nome, {{2}} = tema (já com a empresa). O texto aqui é cópia fiel do que
// foi submetido à Meta — serve para gravar no histórico o que o lead recebeu (a Lis lê esse
// histórico quando ele responde). Nome do template no env CADENCE_WA_TEMPLATE_STEP2 (ou
// _P1/_P3) e parâmetros em CADENCE_WA_PARAMS_STEP2 = "name,tema".
export interface WaTemplateDef { name: string; body: string }

export const WA_D3_TEMPLATE: WaTemplateDef = {
  name: 'lis_d3_fabiano_v1',
  body:
    'Oi {{1}}, aqui é a Lis, assistente do Fabiano Souza, da Trajetória Consultoria. ' +
    'Ele te mandou um e-mail há alguns dias com uma pergunta rápida sobre {{2}}. ' +
    'Se for mais prático, pode responder por aqui. Se preferir não receber mensagens, é só me dizer.',
};

// Templates do lote 1 (só para o histórico continuar legível).
const LEGACY_WA_TEMPLATES: WaTemplateDef[] = [
  {
    name: 'lis_d3_p1_v1',
    body: 'Oi {{1}}, aqui é a Lis, da Trajetória Consultoria. Te escrevi por e-mail com uma pergunta: se você ficasse 30 dias sem aparecer na {{2}}, o que pararia primeiro? Pode responder por aqui, se preferir. Se não quiser receber mensagens, é só me dizer.',
  },
  {
    name: 'lis_d3_p3_v1',
    body: 'Oi {{1}}, aqui é a Lis, da Trajetória Consultoria. Te escrevi por e-mail com uma pergunta: no último fechamento, em que dia útil a diretoria passou a confiar nos números da {{2}}: dia 3, dia 10 ou depois? Pode responder por aqui, se preferir. Se não quiser receber mensagens, é só me dizer.',
  },
];

/** Texto do template de WhatsApp pelo nome (para o histórico), ou '' se desconhecido. */
export function waTemplateBody(name: string): string {
  if (name === WA_D3_TEMPLATE.name) return WA_D3_TEMPLATE.body;
  return LEGACY_WA_TEMPLATES.find((t) => t.name === name)?.body ?? '';
}

type Vars = { nome: string; empresa: string };

function render(text: string, persona: CadencePersona, vars: Vars): string {
  const t = TEMA[persona];
  return text
    .replaceAll('{tema_curto}', t.temaCurto)
    .replaceAll('{tema}', t.tema)
    .replaceAll('{nome}', vars.nome)
    .replaceAll('{empresa}', vars.empresa);
}

/** Tema do toque de WhatsApp para a persona ({{2}} do template do D3). */
export function cadenceTema(persona: CadencePersona, vars: Vars): string {
  return render('{tema}', persona, vars);
}

/** Renderiza o e-mail aprovado para a persona + step. null se não houver template. */
export function renderCadenceEmail(
  persona: CadencePersona,
  step: number,
  vars: Vars,
): { subject: string; body: string } | null {
  const body = TEMPLATES[persona]?.[step];
  if (!body) return null;
  const subject = render(SUBJECT[persona], persona, vars);
  return { subject: step === 1 ? subject : `Re: ${subject}`, body: render(body, persona, vars) };
}
