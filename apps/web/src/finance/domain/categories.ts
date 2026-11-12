import { addMonths, compareDates, endOfMonth, startOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { sum } from '../lib/money.js';
import type { Cents } from '../lib/money.js';
import type { Entry } from './types.js';

/**
 * FIN-101 · O que cada categoria pesa.
 *
 * Contagem e total consideram só lançados do mês corrente (RN-02). A média usa
 * os 12 meses completos anteriores ao mês corrente.
 */

const posted = (entries: readonly Entry[], categoryId: string): readonly Entry[] =>
  entries.filter(
    (entry) => entry.categoryId === categoryId && entry.status === 'lancada',
  );

const within = (entry: Entry, from: IsoDate, to: IsoDate): boolean =>
  compareDates(entry.date, from) >= 0 && compareDates(entry.date, to) <= 0;

export type CategoryUsage = {
  readonly count: number;
  readonly total: Cents;
  readonly average12: Cents;
};

export const categoryUsage = (
  entries: readonly Entry[],
  categoryId: string,
  today: IsoDate,
): CategoryUsage => {
  const mine = posted(entries, categoryId);

  const month = mine.filter((entry) =>
    within(entry, startOfMonth(today), endOfMonth(today)),
  );

  const windowFrom = startOfMonth(addMonths(today, -12));
  const windowTo = endOfMonth(addMonths(today, -1));
  const past = sum(
    mine.filter((entry) => within(entry, windowFrom, windowTo)).map((e) => e.cents),
  );

  return {
    count: month.length,
    total: sum(month.map((entry) => entry.cents)),
    // Divisão inteira com arredondamento para o centavo mais próximo.
    average12: Math.floor((past * 2 + 12) / 24),
  };
};
