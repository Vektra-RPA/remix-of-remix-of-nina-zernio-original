// Templates aprovados da cadência (playbook Indústrias v2.2, roteiros 5.1/5.2).
// Copy verbatim aprovada por Fabiano em 21/09/2026 — NÃO gerar por LLM: cadência fria
// usa texto aprovado. O rodapé de descadastro é anexado pelo email-send (não repetir aqui).

export type CadencePersona = 'P1' | 'P3';

export interface CadenceStepDef {
  step: number;
  tipo: string;
  channel: 'email' | 'whatsapp';
  offsetDays: number;
  // Todos os steps são matriculados; o worker decide no envio. Os toques de
  // WhatsApp (D3/D9) só saem quando o template Meta estiver configurado por env
  // (CADENCE_WA_TEMPLATE_STEP{n}); sem isso o worker pula o step sem travar a
  // cadência. `enabled:false` tira o step da matrícula por completo (reserva).
  enabled: boolean;
}

export const CADENCE_STEPS: CadenceStepDef[] = [
  { step: 1, tipo: 'abertura',  channel: 'email',    offsetDays: 0,  enabled: true },
  { step: 2, tipo: 'followup1', channel: 'whatsapp', offsetDays: 3,  enabled: true },
  { step: 3, tipo: 'followup2', channel: 'email',    offsetDays: 6,  enabled: true },
  { step: 4, tipo: 'followup3', channel: 'whatsapp', offsetDays: 9,  enabled: true },
  { step: 5, tipo: 'breakup',   channel: 'email',    offsetDays: 13, enabled: true },
];

export const ENABLED_STEPS = CADENCE_STEPS.filter((s) => s.enabled);

interface EmailTemplate { subject?: string; body: string }

const SUBJECT = '{nome}, uma pergunta sobre a {empresa}';

// Só o step 1 tem assunto próprio; 3 e 5 seguem o mesmo fio ("Re: ...").
const TEMPLATES: Record<CadencePersona, Record<number, EmailTemplate>> = {
  P1: {
    1: {
      subject: SUBJECT,
      body:
        'Oi {nome}, tudo bem?\n\n' +
        'Sou a Lis, da Trajetória Consultoria (Curitiba). Encontrei a {empresa} em uma base profissional pública de indústrias.\n\n' +
        'Trabalhamos com donos de indústrias de médio porte que querem crescer sem estar no meio de todas as decisões da operação.\n\n' +
        'Uma pergunta: se você ficasse 30 dias sem aparecer na {empresa}, o que pararia primeiro?\n\n' +
        'Se fizer sentido, te conto como uma indústria resolveu isso. Se não for prioridade, é só me avisar.\n\n' +
        'Lis · Trajetória Consultoria · Curitiba',
    },
    3: {
      body:
        '{nome}, retomando. Numa indústria de médio porte, o dono não liberava compras e pagamentos com tranquilidade: não via o que já estava comprometido no mês contra o orçamento e duvidava se o comprador fechava o melhor negócio. Colocamos uma IA para cruzar cada pedido com a previsão de caixa, o histórico de compras e o orçamento anual. Hoje ele só entra no fluxo quando algo foge do planejado.\n\n' +
        'Posso te mandar em uma página como foi? Se não for você quem cuida disso, me diz quem é que eu falo com a pessoa.\n\n' +
        'Lis',
    },
    5: {
      body:
        '{nome}, vou encerrar por aqui para não insistir. Se em algum momento você quiser olhar como a {empresa} organiza pedido, produção e informação, é só responder este e-mail. E se houver alguém aí que cuide de processos ou melhoria contínua, posso falar com essa pessoa?\n\n' +
        'Obrigada pelo tempo. Lis',
    },
  },
  P3: {
    1: {
      subject: SUBJECT,
      body:
        'Oi {nome}, tudo bem?\n\n' +
        'Sou a Lis, da Trajetória Consultoria (Curitiba). Encontrei seu contato em uma base profissional pública.\n\n' +
        'Uma pergunta: no último fechamento, em que dia útil a diretoria passou a confiar nos números da {empresa}: dia 3, dia 10 ou depois disso?\n\n' +
        'Trabalhamos com indústrias de médio porte para automatizar essas rotinas e chegar às informações mais cedo e com menos erro. Numa indústria, um robô que busca as notas emitidas nos portais e dá entrada automática encurtou o fechamento em 4 dias.\n\n' +
        'Se fizer sentido, te mando em uma página como foi. Se não for com você, quem cuida disso aí?\n\n' +
        'Lis · Trajetória Consultoria · Curitiba',
    },
    3: {
      body:
        '{nome}, retomando. Numa indústria de médio porte, o fechamento mensal dependia da entrada das notas fiscais, que chegavam quase todas no fim do mês. Colocamos um robô para buscar nos portais as notas emitidas, validar com as ordens de compra em aberto e dar entrada automática. O fechamento ficou 4 dias mais curto, com a garantia de que todas as notas entram.\n\n' +
        'Posso te mandar em uma página como foi? Se essa parte é de outra pessoa, me indica quem.\n\n' +
        'Lis',
    },
    5: {
      body:
        '{nome}, vou encerrar por aqui. Se um dia reduzir o trabalho manual de consolidação virar prioridade na {empresa}, é só responder este e-mail. Se houver alguém em controladoria que cuide disso, posso falar com essa pessoa?\n\n' +
        'Obrigada. Lis',
    },
  },
};

function render(text: string, vars: { nome: string; empresa: string }): string {
  return text.replaceAll('{nome}', vars.nome).replaceAll('{empresa}', vars.empresa);
}

/** Renderiza o e-mail aprovado para a persona + step. null se não houver template. */
export function renderCadenceEmail(
  persona: CadencePersona,
  step: number,
  vars: { nome: string; empresa: string },
): { subject: string; body: string } | null {
  const tpl = TEMPLATES[persona]?.[step];
  if (!tpl) return null;
  const subject = tpl.subject ? render(tpl.subject, vars) : `Re: ${render(SUBJECT, vars)}`;
  return { subject, body: render(tpl.body, vars) };
}
