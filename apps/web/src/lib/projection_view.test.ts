import { describe, expect, it } from 'vitest';

import {
  fromCents,
  horizonFromParam,
  monthLabel,
  monthlyContributions,
  parseAmountText,
  parseReturnText,
  rulesAmountAt,
  toCents,
} from './projection_view.js';

describe('projection_view', () => {
  it('horizonte desconhecido volta ao padrão de 2 anos', () => {
    expect(horizonFromParam('60')).toBe(60);
    expect(horizonFromParam('18')).toBe(24);
    expect(horizonFromParam(null)).toBe(24);
  });

  it('rentabilidade aceita vírgula e duas casas; vazio é sem rentabilidade', () => {
    expect(parseReturnText('13,75')).toBe('13.75');
    expect(parseReturnText('10')).toBe('10.00');
    expect(parseReturnText('')).toBeNull();
    expect(parseReturnText('101')).toBeUndefined();
    expect(parseReturnText('1,234')).toBeUndefined();
  });

  it('valor de regra: milhar e vírgula, nunca zero', () => {
    expect(parseAmountText('1.000,5')).toBe('1000.50');
    expect(parseAmountText('2000')).toBe('2000.00');
    expect(parseAmountText('0')).toBeUndefined();
    expect(parseAmountText('abc')).toBeUndefined();
  });

  it('centavos inteiros ida e volta, sem ponto flutuante', () => {
    expect(toCents('3000.10')).toBe(300010n);
    expect(fromCents(300010n)).toBe('3000.10');
    expect(fromCents(-5n)).toBe('-0.05');
  });

  it('soma as regras ativas no mês (fixture: 1.000 + 2.000 = 3.000)', () => {
    const rules = [
      { amount: '1000.00', from: '2026-01', until: null },
      { amount: '2000.00', from: '2026-03', until: '2026-05' },
    ];
    expect(rulesAmountAt(rules, '2026-02')).toBe('1000.00');
    expect(rulesAmountAt(rules, '2026-04')).toBe('3000.00');
    expect(rulesAmountAt(rules, '2026-06')).toBe('1000.00');
  });

  it('o aporte do mês é a diferença dos acumulados', () => {
    const point = (month: string, acc: string) => ({
      month,
      value: '0.00',
      contributions_cumulative: acc,
      yield_cumulative: '0.00',
    });
    expect(
      monthlyContributions({
        series: [
          point('2026-11', '0.00'),
          point('2026-12', '3000.00'),
          point('2027-01', '6000.00'),
        ],
        kpis: {
          today: '0.00',
          at_horizon: '0.00',
          contributions: '0.00',
          estimated_yield: '0.00',
        },
      }),
    ).toEqual(['0.00', '3000.00', '3000.00']);
  });

  it('rótulo de mês em pt-BR', () => {
    expect(monthLabel('2026-11')).toBe('nov/2026');
  });
});
