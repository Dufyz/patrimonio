import {
  addMonths,
  compareDates,
  diffDays,
  endOfMonth,
  monthKey,
  startOfMonth,
} from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { allocatePercentTenths } from '../lib/format.js';
import type { Cents } from '../lib/money.js';
import { comparisonRange } from '../lib/period.js';
import type { DateRange } from '../lib/period.js';
import { accountsOverview } from './accounts.js';
import { cardSummary, openInvoicesTotal } from './cards.js';
import type { CardSummary } from './cards.js';
import { indicators, isPosted } from './ledger.js';
import type { Entry, FinanceData } from './types.js';

/**
 * Visão geral (FIN-601 a FIN-604): só resume números que as outras telas
 * produzem. Nada aqui é calculado de outro jeito.
 */

/** Lançados do período, inclusive o histórico, que conta nas médias (RN-63). */
const postedEntries = (data: FinanceData): readonly Entry[] =>
  data.entries.filter(isPosted);

export type MonthResult = {
  readonly receitas: { readonly cents: Cents; readonly count: number };
  readonly despesas: { readonly cents: Cents; readonly count: number };
  readonly saldo: Cents;
  readonly accountsCents: Cents;
  readonly accountsCount: number;
  readonly invoicesCents: Cents;
  /** "Itaú 30/10 · Nubank 05/11": o vencimento mais próximo de cada conta pagadora. */
  readonly dueByAccount: readonly { readonly name: string; readonly due: IsoDate }[];
};

export const monthResult = (
  data: FinanceData,
  range: DateRange,
  today: IsoDate,
): MonthResult => {
  const flows = indicators(postedEntries(data), range);
  const overview = accountsOverview(data, range, today, false);
  const summaries: readonly CardSummary[] = data.cards.map((card) =>
    cardSummary(data, card, today),
  );
  const owing = summaries.filter((item) => item.usedCents > 0);
  const dueByAccount = [...new Set(owing.map((item) => item.card.payerId))]
    .map((payerId) => {
      const earliest = owing
        .filter((item) => item.card.payerId === payerId)
        .map((item) => item.invoice.due)
        .sort()[0] as IsoDate;
      const account = data.accounts.find((a) => a.id === payerId);
      return { name: (account?.name ?? payerId).split(' ')[0] ?? '', due: earliest };
    })
    .sort((a, b) => compareDates(a.due, b.due));
  return {
    receitas: flows.receitas,
    despesas: flows.despesas,
    saldo: flows.saldo,
    accountsCents: overview.totalBalance,
    accountsCount: overview.accounts.length,
    invoicesCents: openInvoicesTotal(summaries),
    dueByAccount,
  };
};

export type MonthPoint = {
  readonly key: string;
  readonly start: IsoDate;
  readonly receitas: Cents;
  readonly despesas: Cents;
  readonly saldo: Cents;
  /** O mês do período. */
  readonly selected: boolean;
  /** O mês ainda em andamento (RN-63): a barra parcial é desenhada mais escura. */
  readonly inProgress: boolean;
};

/** FIN-602 · Os 12 meses de calendário que terminam no mês do período. */
export const monthSeries = (
  data: FinanceData,
  range: DateRange,
  today: IsoDate,
): readonly MonthPoint[] => {
  const entries = postedEntries(data);
  const last = startOfMonth(range.to);
  return Array.from({ length: 12 }, (_, index) => {
    const start = startOfMonth(addMonths(last, index - 11));
    const month = { from: start, to: endOfMonth(start) };
    const flows = indicators(entries, month);
    return {
      key: monthKey(start),
      start,
      receitas: flows.receitas.cents,
      despesas: flows.despesas.cents,
      saldo: flows.saldo,
      selected: index === 11,
      inProgress:
        compareDates(today, month.from) >= 0 && compareDates(today, month.to) <= 0,
    };
  });
};

export type CategoryShare = {
  readonly categoryId: string;
  readonly cents: Cents;
  readonly previous: Cents;
  /** Décimos de ponto percentual; somam 1000 (RN-64). */
  readonly tenths: number;
};

export type CategoryBreakdown = {
  readonly total: Cents;
  readonly comparison: DateRange;
  readonly rows: readonly CategoryShare[];
};

/** FIN-603 · Despesa lançada por categoria, da maior para a menor, e o período de comparação (RN-62). */
export const categoryBreakdown = (
  data: FinanceData,
  range: DateRange,
): CategoryBreakdown => {
  const comparison = comparisonRange(range);
  const entries = postedEntries(data).filter((entry) => entry.kind === 'despesa');
  const within = (entry: Entry, period: DateRange): boolean =>
    compareDates(entry.date, period.from) >= 0 &&
    compareDates(entry.date, period.to) <= 0;
  const totals = new Map<string, Cents>();
  for (const entry of entries.filter((e) => within(e, range))) {
    totals.set(entry.categoryId, (totals.get(entry.categoryId) ?? 0) + entry.cents);
  }
  const ordered = [...totals.entries()]
    .filter(([, cents]) => cents > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const tenths = allocatePercentTenths(ordered.map(([, cents]) => cents));
  return {
    total: ordered.reduce((acc, [, cents]) => acc + cents, 0),
    comparison,
    rows: ordered.map(([categoryId, cents], index) => ({
      categoryId,
      cents,
      previous: entries
        .filter((e) => e.categoryId === categoryId && within(e, comparison))
        .reduce((acc, e) => acc + e.cents, 0),
      tenths: tenths[index] ?? 0,
    })),
  };
};

export const periodLength = (range: DateRange): number =>
  diffDays(range.from, range.to) + 1;
