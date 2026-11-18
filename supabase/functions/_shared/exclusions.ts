// Exclusões de prospecção (playbook: não abordar o próprio time/sócios nem clientes
// ativos/ex-clientes). Equivale ao DOMINIOS_PROPRIOS + dedup.py da Lis Python.
//
// Domínios próprios vêm com um default seguro e podem ser estendidos por env
// (CADENCE_EXCLUDED_DOMAINS, lista separada por vírgula) — é aí que entram os
// domínios de clientes ativos, sem precisar de tabela/migração.

const DEFAULT_OWN_DOMAINS = [
  'trajetoriaconsultoria.com.br',
  'trajetoriaconsultoria.com',
  'vektra.com.br',
  'vektra.com',
];

function excludedDomainSet(): Set<string> {
  const extra = (Deno.env.get('CADENCE_EXCLUDED_DOMAINS') || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return new Set<string>([...DEFAULT_OWN_DOMAINS, ...extra]);
}

/** Domínio de um e-mail ("joao@acme.com.br" -> "acme.com.br"). */
export function emailDomain(email?: string | null): string | null {
  const match = String(email ?? '').toLowerCase().match(/@([\w.-]+)$/);
  return match ? match[1] : null;
}

/** true se o domínio é próprio ou de cliente ativo (match exato ou subdomínio). */
export function isExcludedDomain(domain?: string | null): boolean {
  const dom = String(domain ?? '').toLowerCase().replace(/^@/, '').trim();
  if (!dom) return false;
  for (const d of excludedDomainSet()) {
    if (dom === d || dom.endsWith('.' + d)) return true;
  }
  return false;
}

/** true se o e-mail é de domínio próprio ou de cliente ativo — não prospectar. */
export function isExcludedEmail(email?: string | null): boolean {
  return isExcludedDomain(emailDomain(email));
}

// Playbook 1.3: e-mails genéricos (contato@, comercial@, sac@...) ficam fora da campanha.
const GENERIC_LOCAL_PARTS = new Set([
  'contato', 'contatos', 'comercial', 'sac', 'atendimento', 'vendas', 'faleconosco',
  'info', 'contact', 'suporte', 'adm', 'administrativo', 'administracao', 'financeiro',
  'compras', 'rh', 'marketing', 'orcamento', 'orcamentos', 'ouvidoria', 'recepcao',
  'noreply', 'no-reply', 'naoresponda', 'geral', 'empresa',
]);

/** true se o e-mail é de caixa genérica (não é de uma pessoa). */
export function isGenericEmail(email?: string | null): boolean {
  const local = String(email ?? '').toLowerCase().trim().split('@')[0];
  return !!local && GENERIC_LOCAL_PARTS.has(local);
}

function letters(value: string): string {
  // sem acento: o NFD separa a letra do acento e o [^a-z] descarta o resto
  return value.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
}

/**
 * O e-mail parece ser da própria pessoa? (checklist do lote 2: validar o contato.) No lote 1
 * a Apollo trouxe como "verified" o e-mail de uma colega para um diretor que nem
 * trabalhava mais lá. Aceita quando a parte antes do @ contém o primeiro nome, um sobrenome
 * (3+ letras) ou começa pelas iniciais (ex.: mb@ para Marco Bueno). Sem nome: não bloqueia.
 */
export function emailMatchesName(email?: string | null, fullName?: string | null): boolean {
  const local = letters(String(email ?? '').split('@')[0] ?? '');
  const parts = String(fullName ?? '').split(/\s+/).map(letters).filter(Boolean);
  if (!local || parts.length === 0) return true;
  if (parts.some((p) => p.length >= 3 && local.includes(p))) return true;
  if (parts.some((p) => p.length >= 4 && local.includes(p.slice(0, 4)))) return true; // apelido/abreviação
  const initials = parts.map((p) => p[0]).join('');
  return initials.length >= 2 && local.startsWith(initials.slice(0, 2));
}
