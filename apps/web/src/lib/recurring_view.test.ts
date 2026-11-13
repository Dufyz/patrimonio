import { describe, expect, it } from 'vitest';

import {
  activeTotal,
  blockWeights,
  EMPTY_RECURRING_FILTERS,
  filterRecurrings,
  groupRecurrings,
  monthlyResult,
  summaryLabel,
} from './recurring_view.js';
import type { RecurringResource } from './recurring_view.js';

const item = (over: Partial<RecurringResource>): RecurringResource => ({
  id: 'x',
  name: 'Item',
  kind: 'despesa',
  category_id: 'c1',
  portfolio_id: null,
  asset_id: null,
  source: { type: 'conta', id: 'a1' },
  second_source: null,
  covers_up_to: null,
  day: 5,
  mode: 'manual',
  amount: '100.00',
  active: true,
  version: 1,
  ...over,
});

const names = {
  category: (id: string | null) => (id === 'c1' ? 'Moradia' : 'Mercado'),
  source: (id: string) => (id === 'a1' ? 'Nubank' : 'Itaú'),
};

describe('Recorrentes (REC-01/02)', () => {
  const items = [
    item({ id: 'r', kind: 'receita', amount: '8000.00', category_id: 'c2' }),
    item({ id: 'd1', amount: '1200.00' }),
    item({ id: 'd2', amount: '300.00', active: false }),
    item({
      id: 'ap',
      kind: 'aporte',
      amount: '2000.00',
      category_id: null,
      portfolio_id: 'p1',
    }),
  ];

  it('resultado mensal = receitas − despesas − aportes, só dos ativos', () => {
    expect(monthlyResult(items)).toBe('4800.00');
  });

  it('o total do bloco soma só os ativos e o resumo conta ativas e pausadas', () => {
    expect(activeTotal(items.filter((i) => i.kind === 'despesa'))).toBe('1200.00');
    expect(summaryLabel(items)).toBe('3 ativas · 1 pausada');
  });

  it('os pesos do bloco somam exatamente 1000 décimos e pausado não pesa', () => {
    const block = [
      item({ id: 'a', amount: '10.00' }),
      item({ id: 'b', amount: '10.00' }),
      item({ id: 'c', amount: '10.00' }),
      item({ id: 'p', amount: '99.00', active: false }),
    ];
    const weights = blockWeights(block);
    expect([...weights.values()].reduce((s, v) => s + v, 0)).toBe(1000);
    expect(weights.has('p')).toBe(false);
  });

  it('agrupa por tipo na ordem receitas, despesas, aportes', () => {
    const groups = groupRecurrings(items, 'tipo', names);
    expect(groups.map((g) => g.label)).toEqual(['Receitas', 'Despesas', 'Aportes']);
    expect(groups[1]?.total).toBe('1200.00');
  });

  it('agrupa por conta e por categoria (aporte vai para Aportes)', () => {
    expect(groupRecurrings(items, 'conta', names).map((g) => g.label)).toEqual([
      'Nubank',
    ]);
    expect(groupRecurrings(items, 'categoria', names).map((g) => g.label)).toEqual([
      'Aportes',
      'Mercado',
      'Moradia',
    ]);
  });

  it('filtra por busca, tipo, situação e modo; o resultado acompanha os visíveis', () => {
    const visible = filterRecurrings(items, {
      ...EMPTY_RECURRING_FILTERS,
      kinds: ['despesa'],
      situation: ['ativo'],
    });
    expect(visible.map((i) => i.id)).toEqual(['d1']);
    expect(monthlyResult(visible)).toBe('-1200.00');
    expect(
      filterRecurrings(items, { ...EMPTY_RECURRING_FILTERS, q: 'zzz' }),
    ).toHaveLength(0);
  });
});
