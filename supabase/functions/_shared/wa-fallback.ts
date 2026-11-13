// E-mail de reforço quando o toque de WhatsApp da cadência não chega ao lead:
// a Meta barrou (limite de marketing por destinatário, 131049), o número não tem
// WhatsApp (131026) ou o lead não tem celular. Alinhamento Amanda + Erick (13/11/2026):
// tenta o WhatsApp; se não der, vai um e-mail no mesmo fio com o número da Lis e um
// botão verde que abre o WhatsApp com uma mensagem pronta. Quando o lead escreve
// primeiro, abre a janela de 24h da Meta e o limite de marketing não vale mais.
//
// Texto proposto: o recurso só liga com CADENCE_WA_FALLBACK=true, depois do OK do
// Fabiano (cadência fria usa texto aprovado). O rodapé de descadastro vem do email-send.
// Módulo sem dependências: é usado pelo cadence-worker, pelo whatsapp-webhook e
// pelos testes (vitest).

export type WaFallbackReason = 'nao_entregue' | 'sem_whatsapp';

export interface WaFallbackInput {
  persona: 'P1' | 'P3' | null;
  /** Toque de WhatsApp que não chegou (2 = D3, 4 = D9). */
  step: number;
  reason: WaFallbackReason;
  /** Primeiro nome para a saudação ('' se não houver). */
  nome: string;
  /** Nome da empresa ('' se não houver). */
  empresa: string;
  /** Assunto do fio da cadência, já com "Re:". */
  subject: string;
  /** Número da Lis só com dígitos, com DDI (ex.: 5542999978531). */
  phone: string;
  /** Código que liga a conversa do WhatsApp ao contato (ver newWaRef). */
  ref: string;
  /**
   * PNG público do ícone do WhatsApp em branco, que vai à esquerda do texto do botão
   * (public/email/whatsapp-branco.png na Vercel). Vazio = botão só com texto.
   */
  iconUrl?: string;
}

export interface WaFallbackEmail {
  subject: string;
  text: string;
  html: string;
  link: string;
}

/** Verde do botão: lembra o WhatsApp e mantém contraste 5:1 com o texto branco. */
export const WA_FALLBACK_GREEN = '#15803D';

const SIGNATURE = 'Lis · Trajetória Consultoria · Curitiba';

// Sem I, L, O, 0 e 1 para o código não ser lido errado.
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REF_PATTERN = /\s*\(\s*c[oó]d\.?\s*([A-HJKMNP-Z2-9]{5})\s*\)/i;
const REF_PATTERN_ALL = new RegExp(REF_PATTERN.source, 'gi');

/** Código curto que vai na mensagem pronta do WhatsApp (ex.: K7Q2M). */
export function newWaRef(random: () => number = Math.random): string {
  let ref = '';
  for (let i = 0; i < 5; i += 1) ref += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  return ref;
}

/** Código da mensagem pronta, se o lead o manteve no texto. */
export function extractWaRef(text: string): string | null {
  const match = REF_PATTERN.exec(text || '');
  return match ? match[1].toUpperCase() : null;
}

/** Tira o código do texto que a Lis lê (ele só serve para achar o contato). */
export function stripWaRef(text: string): string {
  return (text || '').replace(REF_PATTERN_ALL, '').trim();
}

/** (42) 99997-8531 a partir de 5542999978531. */
export function formatBrPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  const local = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits;
}

/** Mensagem que o WhatsApp abre pronta quando o lead clica no botão. */
export function waFallbackPrefill(nome: string, empresa: string, ref: string): string {
  const quem = nome && empresa ? `Aqui é ${nome}, da ${empresa}. `
    : nome ? `Aqui é ${nome}. `
    : empresa ? `Falo da ${empresa}. `
    : '';
  return `Oi, Lis! ${quem}Vi seu e-mail. (cód. ${ref})`;
}

export function waFallbackLink(phone: string, prefill: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(prefill)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** A pergunta do e-mail de abertura, retomada no reforço do D3 (o D9 não repete). */
function openingQuestion(persona: WaFallbackInput['persona'], empresa: string): string | null {
  const alvo = empresa || 'empresa';
  if (persona === 'P1') return `se você ficasse 30 dias sem aparecer na ${alvo}, o que pararia primeiro?`;
  if (persona === 'P3') return `no último fechamento, em que dia útil a diretoria passou a confiar nos números da ${alvo}: dia 3, dia 10 ou depois disso?`;
  return null;
}

export function buildWaFallbackEmail(input: WaFallbackInput): WaFallbackEmail {
  const saudacao = input.nome ? `Oi ${input.nome}, ` : 'Oi, ';
  const abertura = input.reason === 'sem_whatsapp'
    ? `${saudacao}não encontrei um WhatsApp seu, então deixo o meu por aqui.`
    : `${saudacao}tentei te mandar uma mensagem no WhatsApp, mas ela não chegou.`;
  const pergunta = input.step === 2 ? openingQuestion(input.persona, input.empresa) : null;
  const retomada = pergunta
    ? (input.reason === 'sem_whatsapp' ? `Retomando a pergunta do meu e-mail: ${pergunta}` : `Era sobre a pergunta do meu e-mail: ${pergunta}`)
    : null;
  const numero = formatBrPhone(input.phone);
  const link = waFallbackLink(input.phone, waFallbackPrefill(input.nome, input.empresa, input.ref));
  const shortLink = `https://wa.me/${input.phone.replace(/\D/g, '')}`;
  const convite = (como: string) =>
    `Se for mais prático conversar pelo WhatsApp, é só me chamar no ${numero} ou ${como}. Se preferir, pode responder este e-mail mesmo.`;

  const text = [
    abertura,
    ...(retomada ? [retomada] : []),
    convite('pelo link abaixo'),
    `Conversar no WhatsApp: ${shortLink}`,
    SIGNATURE,
  ].join('\n\n');

  const p = (inner: string) => `<p style="margin:0 0 14px">${inner}</p>`;
  const conviteHtml = escapeHtml(convite('clicar no botão abaixo'))
    .replace(escapeHtml(numero), `<strong style="white-space:nowrap">${escapeHtml(numero)}</strong>`);
  // alt vazio: se o leitor bloquear imagens (Outlook), o botão continua só com o texto.
  const icon = input.iconUrl
    ? `<img src="${escapeHtml(input.iconUrl)}" width="20" height="20" alt="" ` +
      `style="display:inline-block;width:20px;height:20px;border:0;outline:none;vertical-align:middle;margin-right:8px">`
    : '';
  const button =
    `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:4px 0 18px">` +
    `<tr><td align="center" bgcolor="${WA_FALLBACK_GREEN}" style="border-radius:6px">` +
    `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" ` +
    `style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;` +
    `font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;border-radius:6px">` +
    `${icon}<span style="vertical-align:middle">Conversar no WhatsApp</span></a></td></tr></table>`;
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2933">',
    p(escapeHtml(abertura)),
    ...(retomada ? [p(escapeHtml(retomada))] : []),
    p(conviteHtml),
    button,
    p(escapeHtml(SIGNATURE)),
    '</div>',
  ].join('\n');

  return { subject: input.subject, text, html, link };
}
