import { describe, expect, it } from 'vitest';

import type { PilotLoteRow, PilotTouch } from '../services/pilot';
import {
  bucketOf,
  buildActivity,
  buildCadence,
  buildFunnel,
  groupBySituacao,
  situacaoOf,
  toViews,
} from './campaign-dashboard';

const touch = (step: number, canal: PilotTouch['canal'], state: PilotTouch['state'], at: string | null = null): PilotTouch =>
  ({ step, canal, state, at, detail: null });

const row = (patch: Partial<PilotLoteRow>): PilotLoteRow => ({
  contactId: 'c1',
  nome: 'Lead',
  empresa: 'Empresa',
  cargo: 'CFO',
  persona: 'P3',
  score: 80,
  touches: [],
  entregue: true,
  respondeu: false,
  autorizacao: null,
  replyType: null,
  replyTypeSuggested: null,
  reuniao: null,
  qualificada: false,
  lossReason: null,
  lossReasonSuggested: null,
  optOut: false,
  optOutReason: null,
  bounced: false,
  respondeuEm: null,
  canalResposta: null,
  ...patch,
});

describe('campaign dashboard', () => {
  it('classifica e-mail enviado como entregue e WhatsApp sem recibo como aguardando', () => {
    expect(bucketOf(touch(1, 'E-mail', 'enviado'))).toBe('entregue');
    expect(bucketOf(touch(2, 'WhatsApp', 'enviado'))).toBe('aguardando');
    expect(bucketOf(touch(2, 'WhatsApp', 'lido'))).toBe('entregue');
    expect(bucketOf(touch(2, 'WhatsApp', 'barrado'))).toBe('barrado');
    expect(bucketOf(touch(3, 'E-mail', 'cancelado'))).toBe('pulado');
  });

  it('põe cada lead em uma só situação, com o motivo de saída', () => {
    expect(situacaoOf(row({ optOut: true, optOutReason: 'sem interesse', respondeu: true })))
      .toEqual({ situacao: 'saiu', detalhe: 'sem interesse' });
    expect(situacaoOf(row({ respondeu: true, lossReason: 'Mudou de cargo ou empresa' })).situacao).toBe('saiu');
    expect(situacaoOf(row({ respondeu: true, canalResposta: 'whatsapp' })).detalhe).toMatch(/^Respondeu pelo WhatsApp/);
    expect(situacaoOf(row({ reuniao: '05/11 10:00', optOut: false })).situacao).toBe('reuniao');
    expect(situacaoOf(row({ touches: [touch(1, 'E-mail', 'enviado'), touch(3, 'E-mail', 'pendente', '2026-11-03T12:00:00Z')] })))
      .toEqual({ situacao: 'em_cadencia', detalhe: 'Próximo: D6 · E-mail em 03/11' });
    expect(situacaoOf(row({ touches: [touch(1, 'E-mail', 'enviado')] })).situacao).toBe('concluiu');
  });

  it('monta funil, cadência e situação contando pessoas', () => {
    const rows = [
      row({ contactId: 'a', touches: [touch(1, 'E-mail', 'enviado'), touch(2, 'WhatsApp', 'lido'), touch(3, 'E-mail', 'pendente', '2026-11-03T12:00:00Z')] }),
      row({ contactId: 'b', respondeu: true, touches: [touch(1, 'E-mail', 'enviado'), touch(2, 'WhatsApp', 'barrado')] }),
      row({ contactId: 'c', optOut: true, touches: [touch(1, 'E-mail', 'enviado'), touch(2, 'WhatsApp', 'cancelado')] }),
    ];
    const funnel = Object.fromEntries(buildFunnel(rows).map((s) => [s.key, s.ids.length]));
    expect(funnel).toMatchObject({ lote: 3, email: 3, whatsapp: 1, respondeu: 1, reuniao: 0 });

    const [d0, d3] = buildCadence(rows);
    expect(d0.buckets.entregue).toHaveLength(3);
    expect(d3).toMatchObject({ dia: 'D3', canal: 'WhatsApp', total: 3, lidos: 1 });
    expect(d3.buckets.barrado).toEqual(['b']);
    expect(d3.buckets.pulado).toEqual(['c']);

    const groups = groupBySituacao(toViews(rows));
    expect(groups).toMatchObject({ em_cadencia: ['a'], conversando: ['b'], saiu: ['c'] });
  });

  it('conta toques e respostas por dia no fuso de São Paulo', () => {
    const rows = [
      row({ touches: [
        touch(1, 'E-mail', 'enviado', '2026-10-20T19:40:00Z'),
        touch(2, 'WhatsApp', 'barrado', '2026-10-27T12:10:00Z'),
        touch(3, 'E-mail', 'pendente', '2026-10-27T13:00:00Z'),
      ] }),
    ];
    const replies = [{ at: '2026-10-28T02:30:00Z', canal: 'WhatsApp' as const }]; // 27/10 23h30 em SP
    const days = buildActivity(rows, replies, 14, new Date('2026-10-28T15:00:00Z'));
    expect(days).toHaveLength(14);
    const byLabel = Object.fromEntries(days.map((d) => [d.label, d]));
    expect(byLabel['20/10'].toquesEmail).toBe(1);
    expect(byLabel['27/10']).toMatchObject({ toquesWhatsapp: 1, toquesEmail: 0, respostasWhatsapp: 1 });
  });
});
