import type { FinKind, FinSnapshot } from '@patrimonio/domain';

import { comparisonRange, isDateInRange } from './dates.js';
import type { DateRange } from './dates.js';
import { allocatePercentTenths, dec, money, total } from './money.js';
import { isPosted, ledgerPool } from './ledger.js';

/**
 * Receitas e despesas por categoria (RN-62, RN-64, RN-70): totais lançados com
 * percentual em décimos que somam 1000, comparativo com o período anterior e
 * contagem de lançamentos. A soma das categorias é exatamente o total do período.
 */

export type CategoryRow = {
  readonly category_id: string;
  readonly name: string;
  readonly color: string;
  readonly archived: boolean;
  readonly amount: string;
  readonly count: number;
  readonly previous_amount: string;
  /** Décimos de ponto percentual; somam 1000. */
  readonly tenths: number;
};

export type CategoryBreakdown = {
  readonly kind: FinKind;
  readonly range: DateRange;
  readonly comparison: DateRange;
  readonly total: string;
  readonly count: number;
  readonly rows: readonly CategoryRow[];
};

export const categoryBreakdown = (
  data: FinSnapshot,
  kind: FinKind,
  range: DateRange,
): CategoryBreakdown => {
  const comparison = comparisonRange(range);
  const posted = ledgerPool(data).filter(
    (entry) => isPosted(entry) && entry.kind === kind,
  );
  const within = (date: string, period: DateRange): boolean =>
    isDateInRange(date, period);

  const current = posted.filter((entry) => within(entry.date, range));
  const byCategory = new Map<string, { amount: ReturnType<typeof dec>; count: number }>();
  for (const entry of current) {
    const slot = byCategory.get(entry.category_id) ?? { amount: dec('0'), count: 0 };
    byCategory.set(entry.category_id, {
      amount: slot.amount.plus(entry.amount),
      count: slot.count + 1,
    });
  }

  const ordered = [...byCategory.entries()]
    .filter(([, slot]) => slot.amount.gt(0))
    .sort((a, b) => b[1].amount.comparedTo(a[1].amount) || a[0].localeCompare(b[0]));
  const tenths = allocatePercentTenths(ordered.map(([, slot]) => slot.amount));

  return {
    kind,
    range,
    comparison,
    total: money(total(ordered.map(([, slot]) => slot.amount))),
    count: ordered.reduce((acc, [, slot]) => acc + slot.count, 0),
    rows: ordered.map(([categoryId, slot], index) => {
      const category = data.categories.find((c) => c.id === categoryId);
      return {
        category_id: categoryId,
        name: category?.name ?? categoryId,
        color: category?.color ?? 'gray',
        archived: category?.archived ?? false,
        amount: money(slot.amount),
        count: slot.count,
        previous_amount: money(
          total(
            posted
              .filter(
                (entry) =>
                  entry.category_id === categoryId && within(entry.date, comparison),
              )
              .map((entry) => dec(entry.amount)),
          ),
        ),
        tenths: tenths[index] ?? 0,
      };
    }),
  };
};

/** Quantos lançamentos do mês corrente cada categoria tem (FIN-B-101). */
export const monthlyEntryCounts = (
  data: FinSnapshot,
  range: DateRange,
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const entry of ledgerPool(data)) {
    if (isDateInRange(entry.date, range)) {
      counts.set(entry.category_id, (counts.get(entry.category_id) ?? 0) + 1);
    }
  }
  return counts;
};

export type CategoryPeriodUsageRow = {
  readonly category_id: string;
  readonly posted: string;
  readonly planned: string;
  /** Lançamentos, lançados e previstos, em qualquer data: decide se o tipo ainda muda. */
  readonly entries_total: number;
};

export type CategoryPeriodUsage = {
  readonly range: DateRange;
  readonly rows: readonly CategoryPeriodUsageRow[];
  /** Total lançado por tipo no período: o mesmo de Despesas na cascata (RN-U16). */
  readonly totals: {
    readonly receita: { readonly posted: string; readonly planned: string };
    readonly despesa: { readonly posted: string; readonly planned: string };
  };
};

/**
 * CAT-01 · O uso de cada categoria no período: lançado e previsto, sem misturar
 * (previsto não entra em lançado). Aporte não é categoria e não aparece. Toda
 * categoria do cadastro vem na resposta, também as sem uso (zeradas).
 */
export const categoryPeriodUsage = (data: FinSnapshot, range: DateRange): CategoryPeriodUsage => {
  const pool = ledgerPool(data);
  const within = pool.filter((entry) => isDateInRange(entry.date, range));
  const sum = (categoryId: string, posted: boolean) =>
    total(
      within
        .filter((e) => e.category_id === categoryId && isPosted(e) === posted)
        .map((e) => dec(e.amount)),
    );

  const rows = data.categories.map((category) => ({
    category_id: category.id,
    posted: money(sum(category.id, true)),
    planned: money(sum(category.id, false)),
    entries_total: pool.filter((e) => e.category_id === category.id).length,
  }));

  const byKind = (kind: FinKind, posted: boolean) =>
    money(
      total(
        within.filter((e) => e.kind === kind && isPosted(e) === posted).map((e) => dec(e.amount)),
      ),
    );

  return {
    range,
    rows,
    totals: {
      receita: { posted: byKind('receita', true), planned: byKind('receita', false) },
      despesa: { posted: byKind('despesa', true), planned: byKind('despesa', false) },
    },
  };
};
