// Lotes da campanha e o dia do playbook de cada toque.
//
// Um lote = leads matriculados juntos na cadência (o lote 1 entrou de uma vez em
// 20/10/2026). Matrículas separadas por mais de LOTE_GAP_DAYS dias abrem um lote novo,
// então o painel separa os lotes sem precisar de um campo próprio no banco.
//
// A sequência mudou a partir do lote 2 (ajustes do Fabiano, 18/11/2026): D0 e-mail,
// D3 WhatsApp, D7 e-mail, D14 e-mail. Lotes que começaram antes disso seguiram a
// sequência antiga (D0, D3, D6, D9, D13) e continuam com os rótulos com que saíram.

export interface LoteInfo {
  numero: number;
  /** Matrícula do primeiro lead do lote (ISO). */
  inicio: string;
  total: number;
}

export const LOTE_GAP_DAYS = 3;

/** 18/11/2026 00h em São Paulo: lotes que começam a partir daqui usam a sequência nova. */
export const SEQUENCE_V2_FROM = '2026-11-18T03:00:00.000Z';

const DAYS_V1: Record<number, string> = { 1: 'D0', 2: 'D3', 3: 'D6', 4: 'D9', 5: 'D13' };
const DAYS_V2: Record<number, string> = { 1: 'D0', 2: 'D3', 3: 'D7', 4: 'D9', 5: 'D14' };

function usesSequenceV1(loteInicio: string | null): boolean {
  if (!loteInicio) return false;
  const at = Date.parse(loteInicio);
  return Number.isFinite(at) && at < Date.parse(SEQUENCE_V2_FROM);
}

/** Dia do playbook do toque (ex.: "D7"), conforme a sequência que o lote seguiu. */
export function touchDay(step: number, loteInicio: string | null): string {
  return (usesSequenceV1(loteInicio) ? DAYS_V1 : DAYS_V2)[step] ?? `Passo ${step}`;
}

/**
 * Agrupa as matrículas em lotes, em ordem de chegada. Um intervalo maior que
 * LOTE_GAP_DAYS entre uma matrícula e a seguinte abre um lote novo.
 */
export function assignLotes(enrollments: Array<{ id: string; at: string }>): {
  loteOf: Map<string, LoteInfo>;
  lotes: LoteInfo[];
} {
  const gapMs = LOTE_GAP_DAYS * 86_400_000;
  const sorted = enrollments
    .map((e) => ({ ...e, ms: Date.parse(e.at) }))
    .filter((e) => Number.isFinite(e.ms))
    .sort((a, b) => a.ms - b.ms);

  const lotes: LoteInfo[] = [];
  const loteOf = new Map<string, LoteInfo>();
  let current: LoteInfo | null = null;
  let previousMs = -Infinity;
  for (const e of sorted) {
    if (!current || e.ms - previousMs > gapMs) {
      current = { numero: lotes.length + 1, inicio: e.at, total: 0 };
      lotes.push(current);
    }
    current.total += 1;
    loteOf.set(e.id, current);
    previousMs = e.ms;
  }
  return { loteOf, lotes };
}

/** Lote mostrado por padrão: o mais recente. */
export const latestLote = (lotes: LoteInfo[]): number | null => lotes.at(-1)?.numero ?? null;
