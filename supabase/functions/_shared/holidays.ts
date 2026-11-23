// Feriados em que a cadência fria não envia nada (23/11/2026, pedido da Amanda).
//
// Padrão: feriados nacionais, os pontos facultativos que param as empresas (Carnaval,
// Quarta-feira de Cinzas, Corpus Christi) e o recesso entre o Natal e o Ano-Novo
// (24/12 a 31/12; o 01/01 já é feriado). Datas móveis saem da Páscoa, calculada para
// qualquer ano. Feriados estaduais e municipais não entram no padrão (cada lead está numa
// cidade): quando valer a pena, entram por env.
//
// CADENCE_HOLIDAYS_EXTRA: datas a mais, separadas por vírgula, no formato AAAA-MM-DD ou
// AAAA-MM-DD..AAAA-MM-DD (intervalo, inclusive). Ex.: "2027-07-09,2026-12-21..2027-01-08".
// CADENCE_HOLIDAYS_RECESS=false tira o recesso de fim de ano do padrão.

const FIXED: Record<string, string> = {
  '01-01': 'Confraternização Universal',
  '04-21': 'Tiradentes',
  '05-01': 'Dia do Trabalho',
  '09-07': 'Independência',
  '10-12': 'Nossa Senhora Aparecida',
  '11-02': 'Finados',
  '11-15': 'Proclamação da República',
  '11-20': 'Dia da Consciência Negra',
  '12-25': 'Natal',
};

const DAY_MS = 86_400_000;

/** Domingo de Páscoa (algoritmo gregoriano anônimo / Meeus-Jones-Butcher), em UTC. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = março, 4 = abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Datas móveis do ano (AAAA-MM-DD -> nome), a partir da Páscoa. */
function movable(year: number): Map<string, string> {
  const easter = easterSunday(year).getTime();
  const at = (offset: number) => isoDay(new Date(easter + offset * DAY_MS));
  return new Map([
    [at(-48), 'Carnaval (segunda)'],
    [at(-47), 'Carnaval (terça)'],
    [at(-46), 'Quarta-feira de Cinzas'],
    [at(-2), 'Sexta-feira Santa'],
    [at(60), 'Corpus Christi'],
  ]);
}

function extraDates(): Array<[string, string]> {
  return (Deno.env.get('CADENCE_HOLIDAYS_EXTRA') || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [from, to] = part.split('..').map((s) => s.trim());
      return [from, to || from] as [string, string];
    })
    .filter(([from, to]) => /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to));
}

/** Nome do feriado (ou recesso) na data AAAA-MM-DD, ou null se é dia normal. */
export function holidayOn(day: string): string | null {
  const year = Number(day.slice(0, 4));
  const monthDay = day.slice(5);
  if (FIXED[monthDay]) return FIXED[monthDay];
  const mov = movable(year).get(day);
  if (mov) return mov;
  const recess = (Deno.env.get('CADENCE_HOLIDAYS_RECESS') || 'true').toLowerCase() !== 'false';
  if (recess && monthDay >= '12-24' && monthDay <= '12-31') return 'Recesso de fim de ano';
  for (const [from, to] of extraDates()) {
    if (day >= from && day <= to) return 'Data bloqueada (CADENCE_HOLIDAYS_EXTRA)';
  }
  return null;
}

/** Feriado de hoje no horário de Brasília (UTC-3), ou null. */
export function holidayToday(nowMs: number = Date.now()): string | null {
  return holidayOn(isoDay(new Date(nowMs - 3 * 3_600_000)));
}
