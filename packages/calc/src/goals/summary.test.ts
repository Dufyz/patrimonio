import { describe, expect, it } from 'vitest';

import { summarizeGoals } from './summary.js';
import type { SummaryItem } from './summary.js';

const reserve: SummaryItem = {
  id: 'reserva',
  current_value: '140279.00',
  target_amount: '180000.00',
  target_date: '2027-12-31',
  expected_pct: '80.00',
  required_monthly: '1062.00',
  current_monthly: '1500.00',
};

const independence: SummaryItem = {
  id: 'independencia',
  current_value: '54719.00',
  target_amount: '400000.00',
  target_date: '2030-06-30',
  expected_pct: '20.00',
  required_monthly: '6762.00',
  current_monthly: '700.00',
};

describe('a soma dos objetivos', () => {
  const summary = summarizeGoals([reserve, independence]);

  it('soma meta, valor atual e o que falta, e o progresso sai do total', () => {
    expect(summary).toMatchObject({
      target_amount: '580000.00',
      current_value: '194998.00',
      remaining_brl: '385002.00',
      progress_pct: '33.62',
    });
  });

  it('pondera o esperado de cada objetivo pela meta', () => {
    // (80 × 180.000 + 20 × 400.000) / 580.000 = 38,62
    expect(summary.expected_pct).toBe('38.62');
  });

  it('o aporte necessário é a soma, e a diferença para o de hoje é o que falta aportar', () => {
    expect(summary).toMatchObject({
      required_monthly: '7824.00',
      current_monthly: '2200.00',
      gap_monthly: '5624.00',
      last_target_date: '2030-06-30',
    });
  });

  it('o necessário cai quando a primeira meta fecha', () => {
    expect(summary.required_schedule).toEqual([
      { until: '2027-12-31', monthly: '7824.00' },
      { until: '2030-06-30', monthly: '6762.00' },
    ]);
  });

  it('cada carteira tem a fatia do necessário e a do que aporta hoje', () => {
    expect(summary.shares['reserva']).toEqual({
      required_share_pct: '13.57',
      current_share_pct: '68.18',
    });
    expect(summary.shares['independencia']).toEqual({
      required_share_pct: '86.43',
      current_share_pct: '31.82',
    });
  });
});

describe('sem objetivos', () => {
  it('devolve zeros e nenhuma data, sem dividir por zero', () => {
    expect(summarizeGoals([])).toMatchObject({
      target_amount: '0.00',
      progress_pct: '0.00',
      expected_pct: null,
      last_target_date: null,
      required_schedule: [],
    });
  });

  it('sem ninguém aportando, a fatia do que se aporta hoje é nula', () => {
    const summary = summarizeGoals([{ ...reserve, current_monthly: '0.00' }]);

    expect(summary.shares['reserva']?.current_share_pct).toBeNull();
  });

  it('o progresso não passa de 100 quando o valor passa da meta', () => {
    const summary = summarizeGoals([{ ...reserve, current_value: '200000.00' }]);

    expect(summary.progress_pct).toBe('100.00');
    expect(summary.remaining_brl).toBe('0.00');
  });
});
