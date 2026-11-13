import { describe, expect, it } from 'vitest';

import {
  WA_FALLBACK_GREEN,
  buildWaFallbackEmail,
  extractWaRef,
  formatBrPhone,
  newWaRef,
  stripWaRef,
  waFallbackPrefill,
  type WaFallbackInput,
} from '../../supabase/functions/_shared/wa-fallback';

const base: WaFallbackInput = {
  persona: 'P1',
  step: 2,
  reason: 'nao_entregue',
  nome: 'Paulo',
  empresa: 'Metalúrgica Alfa',
  subject: 'Re: Paulo, uma pergunta sobre a Metalúrgica Alfa',
  phone: '5542999978531',
  ref: 'K7Q2M',
};

describe('e-mail de reforço do WhatsApp', () => {
  it('avisa que o WhatsApp não chegou, retoma a pergunta e traz número e botão', () => {
    const email = buildWaFallbackEmail(base);
    expect(email.subject).toBe(base.subject);
    expect(email.text).toContain('Oi Paulo, tentei te mandar uma mensagem no WhatsApp, mas ela não chegou.');
    expect(email.text).toContain('se você ficasse 30 dias sem aparecer na Metalúrgica Alfa');
    expect(email.text).toContain('(42) 99997-8531');
    expect(email.text).toContain('https://wa.me/5542999978531');
    expect(email.html).toContain(`bgcolor="${WA_FALLBACK_GREEN}"`);
    expect(email.html).toContain('Conversar no WhatsApp');
    expect(email.html).toContain('clicar no botão abaixo');
    expect(email.link).toBe(
      'https://wa.me/5542999978531?text=' + encodeURIComponent('Oi, Lis! Aqui é Paulo, da Metalúrgica Alfa. Vi seu e-mail. (cód. K7Q2M)'),
    );
  });

  it('lead sem celular recebe o convite sem dizer que a mensagem falhou', () => {
    const email = buildWaFallbackEmail({ ...base, persona: 'P3', reason: 'sem_whatsapp' });
    expect(email.text).toContain('não encontrei um WhatsApp seu');
    expect(email.text).not.toContain('não chegou');
    expect(email.text).toContain('Retomando a pergunta do meu e-mail: no último fechamento');
  });

  it('D9 não repete a pergunta da abertura e o texto vai escapado no HTML', () => {
    const email = buildWaFallbackEmail({ ...base, step: 4, nome: '', empresa: 'A&B <Ltda>' });
    expect(email.text.startsWith('Oi, tentei')).toBe(true);
    expect(email.text).not.toContain('Era sobre a pergunta');
    expect(email.html).not.toContain('<Ltda>');
    expect(waFallbackPrefill('', 'A&B', 'K7Q2M')).toBe('Oi, Lis! Falo da A&B. Vi seu e-mail. (cód. K7Q2M)');
  });

  it('código da mensagem pronta: gera, encontra e some do texto que a Lis lê', () => {
    const ref = newWaRef(() => 0.5);
    expect(ref).toMatch(/^[A-HJKMNP-Z2-9]{5}$/);
    const msg = 'Oi, Lis! Aqui é Paulo, da Metalúrgica Alfa. Vi seu e-mail. (cód. k7q2m)';
    expect(extractWaRef(msg)).toBe('K7Q2M');
    expect(stripWaRef(msg)).toBe('Oi, Lis! Aqui é Paulo, da Metalúrgica Alfa. Vi seu e-mail.');
    expect(extractWaRef('Oi, tudo bem? Quero saber mais (cod 12345)')).toBeNull();
    expect(stripWaRef('Bom dia')).toBe('Bom dia');
  });

  it('ícone do WhatsApp no botão quando há URL, botão só com texto quando não há', () => {
    const icon = 'https://nina-lis.vercel.app/email/whatsapp-branco.png';
    const comIcone = buildWaFallbackEmail({ ...base, iconUrl: icon });
    expect(comIcone.html).toContain(`<img src="${icon}" width="20" height="20" alt=""`);
    expect(comIcone.html.indexOf('<img')).toBeLessThan(comIcone.html.indexOf('Conversar no WhatsApp'));
    expect(comIcone.text).not.toContain('whatsapp-branco.png');
    expect(buildWaFallbackEmail(base).html).not.toContain('<img');
  });

  it('formata o número da Lis', () => {
    expect(formatBrPhone('5542999978531')).toBe('(42) 99997-8531');
    expect(formatBrPhone('4133334444')).toBe('(41) 3333-4444');
  });
});
