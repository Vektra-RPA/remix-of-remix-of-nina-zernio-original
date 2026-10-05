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
