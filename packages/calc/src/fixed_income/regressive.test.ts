import { describe, expect, it } from 'vitest';

import { redemption, regressiveRate } from './regressive.js';

describe('alíquota nas fronteiras', () => {
  it('o limite de cada faixa é inclusive: 180 dias ainda paga 22,5%', () => {
    expect(regressiveRate(1)).toBe('22.5');
    expect(regressiveRate(180)).toBe('22.5');
    expect(regressiveRate(181)).toBe('20');
    expect(regressiveRate(360)).toBe('20');
    expect(regressiveRate(361)).toBe('17.5');
    expect(regressiveRate(720)).toBe('17.5');
    expect(regressiveRate(721)).toBe('15');
  });

  it('resgate no dia 181 cai de 22,5% para 20%', () => {
    const before = redemption({
      principal: '10000.00',
      gross_value: '11000.00',
      issued_at: '2024-01-02',
      redemption_date: '2024-06-30',
      tax_regime: 'regressive',
    });
    const after = redemption({
      principal: '10000.00',
      gross_value: '11000.00',
      issued_at: '2024-01-02',
      redemption_date: '2024-07-01',
      tax_regime: 'regressive',
    });

    expect(before.elapsed_days).toBe(180);
    expect(before.tax_rate).toBe('22.50');
    expect(before.tax_due).toBe('225.00');

    expect(after.elapsed_days).toBe(181);
    expect(after.tax_rate).toBe('20.00');
    expect(after.tax_due).toBe('200.00');
  });

  it('resgate no dia 721 cai de 17,5% para 15%', () => {
    const before = redemption({
      principal: '10000.00',
      gross_value: '12000.00',
      issued_at: '2024-01-02',
      redemption_date: '2025-12-22',
      tax_regime: 'regressive',
    });
    const after = redemption({
      principal: '10000.00',
      gross_value: '12000.00',
      issued_at: '2024-01-02',
      redemption_date: '2025-12-23',
      tax_regime: 'regressive',
    });

    expect(before.elapsed_days).toBe(720);
    expect(before.tax_rate).toBe('17.50');
    expect(before.tax_due).toBe('350.00');

    expect(after.elapsed_days).toBe(721);
    expect(after.tax_rate).toBe('15.00');
    expect(after.tax_due).toBe('300.00');
  });

  it('o prazo conta dia corrido, não dia útil: o feriado não atrasa a faixa', () => {
    // 2024 é bissexto: de 2 de janeiro a 1º de julho são 181 dias corridos,
    // bem menos do que 181 dias úteis.
    expect(
      redemption({
        principal: '1000.00',
        gross_value: '1100.00',
        issued_at: '2024-01-02',
        redemption_date: '2024-07-01',
        tax_regime: 'regressive',
      }).elapsed_days,
    ).toBe(181);
  });
});

describe('valor líquido de resgate', () => {
  it('o líquido aparece separado do bruto na curva', () => {
    const value = redemption({
      principal: '10000.00',
      gross_value: '10500.00',
      issued_at: '2024-01-02',
      redemption_date: '2024-03-01',
      tax_regime: 'regressive',
    });

    expect(value.gross_value).toBe('10500.00');
    expect(value.taxable_base).toBe('500.00');
    expect(value.tax_due).toBe('112.50');
    expect(value.net_value).toBe('10387.50');
  });

  it('título isento não aplica a tabela: a alíquota é zero, não a de mais de 720 dias', () => {
    const value = redemption({
      principal: '10000.00',
      gross_value: '10500.00',
      issued_at: '2024-01-02',
      redemption_date: '2024-03-01',
      tax_regime: 'exempt',
    });

    expect(value.tax_rate).toBe('0.00');
    expect(value.tax_due).toBe('0.00');
    expect(value.net_value).toBe('10500.00');
  });

  it('rendimento negativo não vira base negativa', () => {
    const value = redemption({
      principal: '10000.00',
      gross_value: '9800.00',
      issued_at: '2024-01-02',
      redemption_date: '2024-03-01',
      tax_regime: 'regressive',
    });

    expect(value.taxable_base).toBe('0.00');
    expect(value.tax_due).toBe('0.00');
    expect(value.net_value).toBe('9800.00');
  });

  it('sem rendimento não há imposto', () => {
    const value = redemption({
      principal: '10000.00',
      gross_value: '10000.00',
      issued_at: '2024-01-02',
      redemption_date: '2024-01-02',
      tax_regime: 'regressive',
    });

    expect(value.elapsed_days).toBe(0);
    expect(value.tax_due).toBe('0.00');
  });
});
