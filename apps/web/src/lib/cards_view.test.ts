import { describe, expect, it } from 'vitest';

import type { CardRowResource } from '../api/cards_overview.js';
import {
  barWidth,
  daysBetween,
  dueIn,
  groupByPayer,
  nextDue,
  payerTitle,
} from './cards_view.js';

const row = (
  id: string,
  pay: string,
  abertas: string,
  fechadas: string,
  due: string | null,
) =>
  ({
    card: {
      id,
      name: id,
      last4: '0000',
      pay_account_id: pay,
      limit_amount: '1000.00',
      closing_day: 5,
      due_day: 15,
    },
    debt: { abertas, fechadas_a_pagar: fechadas, next_due: due },
  }) as unknown as CardRowResource;

describe('cards_view', () => {
  const rows = [
    row('a', 'itau', '1000.10', '2100.95', '2026-11-20'),
    row('b', 'itau', '1167.32', '0.00', '2026-12-05'),
    row('c', 'nu', '10.00', '0.00', null),
  ];

  it('agrupa pela conta pagadora e soma abertas + fechadas', () => {
    const groups = groupByPayer(rows);
    expect(groups.map((g) => [g.accountId, g.cards.length, g.due])).toEqual([
      ['itau', 2, '4268.37'],
      ['nu', 1, '10.00'],
    ]);
  });

  it('títulos, vencimento e dias', () => {
    expect(payerTitle('Itaú Unibanco', 3)).toBe('Itaú Unibanco paga 3 cartões');
    expect(payerTitle('Nu', 1)).toBe('Nu paga 1 cartão');
    expect(dueIn(0)).toBe('hoje');
    expect(dueIn(5)).toBe('em 5 dias');
    expect(dueIn(-2)).toBe('venceu há 2 dias');
    expect(nextDue(rows)).toBe('2026-11-20');
    expect(daysBetween('2026-11-13', '2026-11-20')).toBe(7);
  });

  it('barra limita a 100 mas o número real fica na tela', () => {
    expect(barWidth(140)).toBe(100);
    expect(barWidth(-3)).toBe(0);
    expect(barWidth(41.5)).toBe(41.5);
  });
});
