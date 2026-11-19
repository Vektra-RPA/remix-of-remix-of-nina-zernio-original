import { describe, expect, it } from 'vitest';

import { assignLotes, latestLote, touchDay } from './lotes';

describe('lotes da campanha', () => {
  it('agrupa matrículas próximas no mesmo lote e abre outro depois de um intervalo', () => {
    const { loteOf, lotes } = assignLotes([
      { id: 'b', at: '2026-10-20T19:05:00Z' },
      { id: 'a', at: '2026-10-20T19:03:00Z' },
      { id: 'c', at: '2026-10-21T12:00:00Z' }, // dia seguinte: ainda lote 1
      { id: 'd', at: '2026-11-24T12:00:00Z' },
      { id: 'e', at: '2026-11-25T12:00:00Z' },
      { id: 'sem-data', at: '' },
    ]);
    expect(lotes).toEqual([
      { numero: 1, inicio: '2026-10-20T19:03:00Z', total: 3 },
      { numero: 2, inicio: '2026-11-24T12:00:00Z', total: 2 },
    ]);
    expect(loteOf.get('c')?.numero).toBe(1);
    expect(loteOf.get('e')?.numero).toBe(2);
    expect(loteOf.has('sem-data')).toBe(false);
    expect(latestLote(lotes)).toBe(2);
    expect(latestLote([])).toBeNull();
  });

  it('lote 1 mantém os dias da sequência antiga; lotes novos usam D7 e D14', () => {
    const lote1 = '2026-10-20T19:03:00.123+00:00';
    const lote2 = '2026-11-24T12:00:00Z';
    expect([1, 2, 3, 4, 5].map((s) => touchDay(s, lote1))).toEqual(['D0', 'D3', 'D6', 'D9', 'D13']);
    expect([1, 2, 3, 5].map((s) => touchDay(s, lote2))).toEqual(['D0', 'D3', 'D7', 'D14']);
    expect(touchDay(3, null)).toBe('D7');
    expect(touchDay(9, lote2)).toBe('Passo 9');
  });
});
