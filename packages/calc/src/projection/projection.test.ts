import { describe, expect, it } from 'vitest';

import {
  PROJECTION_HORIZONS,
  contributionOfMonth,
  projectionMonthlyRate,
  projectPortfolio,
  projectTotal,
} from './projection.js';

const HOJE = '2026-11-12';

describe('projectPortfolio (PRJ-01)', () => {
  it('doze meses sem aporte rendem exatamente a taxa anual declarada (PA-06)', () => {
    const result = projectPortfolio({
      today: HOJE,
      current_value: '100000.00',
      annual_return_pct: '13.75',
      rules: [],
      horizon_months: 12,
    });

    expect(result.kpis.today).toBe('100000.00');
    expect(result.kpis.at_horizon).toBe('113750.00');
    expect(result.kpis.contributions).toBe('0.00');
    expect(result.kpis.estimated_yield).toBe('13750.00');
  });

  it('t = 0 é o valor atual, no mês de hoje', () => {
    const result = projectPortfolio({
      today: HOJE,
      current_value: '54718.83',
      annual_return_pct: '10.16',
      rules: [{ amount: '1000', from: '2026-11', until: null }],
      horizon_months: 12,
    });

    expect(result.series[0]).toEqual({
      month: '2026-11',
      value: '54718.83',
      contributions_cumulative: '0.00',
      yield_cumulative: '0.00',
    });
    expect(result.series).toHaveLength(13);
    expect(result.series[12]?.month).toBe('2027-11');
  });

  it('saldo(t+1) = saldo(t) × (1 + r_m) + aporte(t), com a regra valendo de ≤ mês ≤ até', () => {
    const result = projectPortfolio({
      today: HOJE,
      current_value: '0',
      annual_return_pct: '0',
      rules: [{ amount: '1000', from: '2026-12', until: '2027-02' }],
      horizon_months: 6,
    });

    // Nov: nada. Dez, jan e fev: 1.000 cada. Depois, nada.
    expect(result.series.map((p) => p.value)).toEqual([
      '0.00',
      '0.00',
      '1000.00',
      '2000.00',
      '3000.00',
      '3000.00',
      '3000.00',
    ]);
    expect(result.kpis.contributions).toBe('3000.00');
    expect(result.kpis.estimated_yield).toBe('0.00');
  });

  it('o aporte do mês é a soma das regras ativas', () => {
    const rules = [
      { amount: '1000', from: '2026-11', until: null },
      { amount: '2000', from: '2027-01', until: '2027-03' },
    ];

    expect(contributionOfMonth(rules, '2026-12').toFixed(2)).toBe('1000.00');
    expect(contributionOfMonth(rules, '2027-02').toFixed(2)).toBe('3000.00');
    expect(contributionOfMonth(rules, '2027-04').toFixed(2)).toBe('1000.00');
    expect(contributionOfMonth(rules, '2026-10').toFixed(2)).toBe('0.00');
  });

  it('rendimento estimado = horizonte − hoje − aportes, em todo horizonte', () => {
    for (const horizon of PROJECTION_HORIZONS) {
      const { kpis, series } = projectPortfolio({
        today: HOJE,
        current_value: '194998.09',
        annual_return_pct: '10.16',
        rules: [{ amount: '3000', from: '2026-11', until: null }],
        horizon_months: horizon,
      });

      const esperado = (
        Number(kpis.at_horizon) -
        Number(kpis.today) -
        Number(kpis.contributions)
      ).toFixed(2);

      expect(kpis.estimated_yield).toBe(esperado);
      expect(series).toHaveLength(horizon + 1);
      expect(series[horizon]?.yield_cumulative).toBe(kpis.estimated_yield);
    }
  });

  it('a taxa mensal é a equivalente, não a anual dividida por 12', () => {
    expect(projectionMonthlyRate('13.75').toNumber()).toBeCloseTo(0.010794, 5);
    expect(projectionMonthlyRate('13.75').toNumber()).not.toBeCloseTo(0.0114583, 5);
  });
});

describe('projectTotal (Todas)', () => {
  it('soma as carteiras mês a mês, e os KPIs fecham com a soma dos KPIs', () => {
    const emergencia = projectPortfolio({
      today: HOJE,
      current_value: '30000.00',
      annual_return_pct: '13.75',
      rules: [{ amount: '1000', from: '2026-11', until: null }],
      horizon_months: 12,
    });
    const investimentos = projectPortfolio({
      today: HOJE,
      current_value: '164998.09',
      annual_return_pct: '10.16',
      rules: [{ amount: '2000', from: '2026-11', until: null }],
      horizon_months: 12,
    });

    const total = projectTotal([emergencia, investimentos]);

    expect(total.kpis.today).toBe('194998.09');
    expect(total.kpis.contributions).toBe('36000.00');
    expect(Number(total.kpis.at_horizon)).toBeCloseTo(
      Number(emergencia.kpis.at_horizon) + Number(investimentos.kpis.at_horizon),
      2,
    );
    expect(total.series).toHaveLength(13);
  });
});
