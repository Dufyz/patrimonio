import { describe, expect, it } from 'vitest';

import { currentMonth } from '../lib/period.js';
import { categoryBreakdown, monthResult, monthSeries } from './overview.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';

const data = seedData();
const TODAY = SEED_REFERENCE_DATE;
const OCTOBER = currentMonth(TODAY);

describe('faixa de totais (FIN-601)', () => {
  const result = monthResult(data, OCTOBER, TODAY);
  it('receitas, despesas e saldo do período', () => {
    expect(result.saldo).toBe(result.receitas.cents - result.despesas.cents);
    expect(result.receitas).toEqual({ cents: 1635000, count: 3 });
    expect(result.despesas).toEqual({ cents: 947810, count: 9 });
    expect(result.saldo).toBe(687190);
  });
  it('em contas e faturas abertas refletem hoje', () => {
    expect(result.accountsCents).toBe(1258385);
    expect(result.accountsCount).toBe(5);
    expect(result.invoicesCents).toBe(542227);
    expect(result.dueByAccount.map((d) => `${d.name} ${d.due}`)).toEqual([
      'Itaú 2026-10-30',
      'Nubank 2026-11-05',
    ]);
  });
});

describe('Receitas × despesas (FIN-602)', () => {
  it('12 meses terminando no mês do período', () => {
    const series = monthSeries(data, OCTOBER, TODAY);
    expect(series).toHaveLength(12);
    expect(series[0]?.key).toBe('2025-11');
    expect(series[11]?.key).toBe('2026-10');
    expect(series[11]?.selected).toBe(true);
    expect(series[11]?.inProgress).toBe(true);
    expect(series[10]?.inProgress).toBe(false);
  });
});

describe('Despesas por categoria (FIN-603)', () => {
  const breakdown = categoryBreakdown(data, OCTOBER);
  it('ordena da maior para a menor, soma 100% e compara com o mês anterior', () => {
    const cents = breakdown.rows.map((r) => r.cents);
    expect([...cents].sort((a, b) => b - a)).toEqual(cents);
    expect(breakdown.rows.reduce((acc, r) => acc + r.tenths, 0)).toBe(1000);
    expect(breakdown.comparison).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(breakdown.total).toBe(947810);
    expect(breakdown.rows[0]).toEqual({
      categoryId: 'investimento',
      cents: 450000,
      previous: 620000,
      tenths: 475,
    });
  });
});
