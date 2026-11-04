import type { FinCategory, FinEntry, FinSnapshot } from '@patrimonio/domain';
import type { Decimal } from 'decimal.js';

import { compareDates, isDateInRange } from './dates.js';
import type { DateRange } from './dates.js';
import { dec, money, total, ZERO } from './money.js';
import { findCategory, sourceName } from './lookup.js';
import { looseAmount, matchesText } from './text.js';

/**
 * Lançamentos: a leitura do livro. Só o lançado conta em totais (RN-02); o
 * previsto aparece à parte. Encargo de cartão conta como despesa na categoria que
 * a pessoa escolheu, então entra no livro como uma linha sintética.
 */

export const isPosted = (entry: FinEntry): boolean => entry.status === 'lancada';

/** Os lançamentos reais mais os encargos de cartão, que contam como despesa lançada. */
export const ledgerPool = (data: FinSnapshot): readonly FinEntry[] => [
  ...data.entries,
  ...data.card_items
    .filter((item) => item.kind === 'encargo' && item.category_id !== null)
    .map((item): FinEntry => ({
      id: item.id,
      kind: 'despesa',
      description: item.description,
      date: item.purchase_date,
      category_id: item.category_id as string,
      amount: item.amount,
      status: 'lancada',
      recurring_id: null,
      installment: null,
      note: 'encargo',
      payments: [
        {
          source_type: 'cartao',
          source_id: item.card_id,
          amount: item.amount,
          invoice_month: item.invoice_month,
        },
      ],
      version: item.version,
    })),
];

export const isCharge = (data: FinSnapshot, entry: FinEntry): boolean =>
  data.card_items.some((item) => item.id === entry.id);

export type Tally = { readonly amount: string; readonly count: number };

const tally = (entries: readonly FinEntry[]): Tally => ({
  amount: money(total(entries.map((entry) => dec(entry.amount)))),
  count: entries.length,
});

export type Indicators = {
  readonly receitas: Tally;
  readonly despesas: Tally;
  /** Receitas − despesas lançadas, com sinal. */
  readonly saldo: string;
  /** Soma dos previstos até o fim do período (RN-13: vencidos continuam somando). */
  readonly a_lancar: Tally;
};

export const indicators = (
  entries: readonly FinEntry[],
  range: DateRange,
): Indicators => {
  const posted = entries.filter(
    (entry) => isPosted(entry) && isDateInRange(entry.date, range),
  );
  const receitas = tally(posted.filter((entry) => entry.kind === 'receita'));
  const despesas = tally(posted.filter((entry) => entry.kind === 'despesa'));
  const pending = entries.filter(
    (entry) => !isPosted(entry) && compareDates(entry.date, range.to) <= 0,
  );
  return {
    receitas,
    despesas,
    saldo: money(dec(receitas.amount).minus(despesas.amount)),
    a_lancar: tally(pending),
  };
};

/**
 * Previsto vencido: manual, ainda previsto e com a data antes de hoje (RN-13).
 * Automático nunca fica vencido, porque vira lançado na data (RN-11).
 */
export const isOverdue = (data: FinSnapshot, entry: FinEntry, today: string): boolean => {
  if (entry.status !== 'prevista' || compareDates(entry.date, today) >= 0) return false;
  const recurring = data.recurrings.find((r) => r.id === entry.recurring_id);
  return recurring?.mode !== 'automatico';
};

/** RN-23: a origem principal é a de maior parte; no empate, a primeira informada. */
export const primarySource = (
  entry: FinEntry,
): FinEntry['payments'][number] | undefined => {
  let best: FinEntry['payments'][number] | undefined;
  for (const payment of entry.payments) {
    if (best === undefined || dec(payment.amount).gt(best.amount)) best = payment;
  }
  return best;
};

export type EntryFilters = {
  readonly range: DateRange;
  readonly kind?: FinEntry['kind'] | undefined;
  readonly category_id?: string | undefined;
  readonly source_id?: string | undefined;
  readonly status?: FinEntry['status'] | undefined;
  readonly q?: string | undefined;
};

/** Ordem estável: data (mais nova primeiro), depois criação — o id v7 cresce com o tempo. */
export const byLedgerOrder = (a: FinEntry, b: FinEntry): number =>
  compareDates(b.date, a.date) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Aplica os filtros da tela; o intervalo vale para o lançado e o previsto igualmente. */
export const filterEntries = (
  data: FinSnapshot,
  filters: EntryFilters,
): readonly FinEntry[] => {
  const q = filters.q?.trim() ?? '';
  const amount = q === '' ? null : looseAmount(q);

  return ledgerPool(data)
    .filter((entry) => {
      if (!isDateInRange(entry.date, filters.range)) return false;
      if (filters.kind !== undefined && entry.kind !== filters.kind) return false;
      if (filters.category_id !== undefined && entry.category_id !== filters.category_id)
        return false;
      if (filters.status !== undefined && entry.status !== filters.status) return false;
      if (
        filters.source_id !== undefined &&
        !entry.payments.some((payment) => payment.source_id === filters.source_id)
      ) {
        return false;
      }
      if (q !== '') {
        const textual = matchesText(q, [
          entry.description,
          findCategory(data, entry.category_id)?.name,
          ...entry.payments.map((p) =>
            sourceName(data, { type: p.source_type, id: p.source_id }),
          ),
        ]);
        const byAmount =
          amount !== null &&
          (dec(entry.amount).eq(amount) ||
            entry.payments.some((p) => dec(p.amount).eq(amount)));
        if (!textual && !byAmount) return false;
      }
      return true;
    })
    .sort(byLedgerOrder);
};

export type GroupBy = 'dia' | 'categoria' | 'origem';

export type LedgerGroup = {
  readonly key: string;
  readonly label: string;
  readonly receitas: string;
  readonly despesas: string;
  readonly saldo: string;
  readonly count: number;
  readonly entries: readonly FinEntry[];
};

const groupKey = (
  data: FinSnapshot,
  entry: FinEntry,
  by: GroupBy,
): { key: string; label: string } => {
  if (by === 'dia') return { key: entry.date, label: entry.date };
  if (by === 'categoria') {
    const category: FinCategory | undefined = findCategory(data, entry.category_id);
    return { key: entry.category_id, label: category?.name ?? entry.category_id };
  }
  const main = primarySource(entry);
  return main === undefined
    ? { key: '-', label: 'Sem origem' }
    : {
        key: main.source_id,
        label: sourceName(data, { type: main.source_type, id: main.source_id }),
      };
};

/** Agrupa; o resumo de cada grupo conta só o lançado (RN-02). */
export const groupEntries = (
  data: FinSnapshot,
  entries: readonly FinEntry[],
  by: GroupBy,
  summaryOver: readonly FinEntry[] = entries,
): readonly LedgerGroup[] => {
  const order: string[] = [];
  const members = new Map<
    string,
    { label: string; entries: FinEntry[]; all: FinEntry[] }
  >();
  const slot = (entry: FinEntry) => {
    const { key, label } = groupKey(data, entry, by);
    let group = members.get(key);
    if (group === undefined) {
      group = { label, entries: [], all: [] };
      members.set(key, group);
      order.push(key);
    }
    return group;
  };
  for (const entry of summaryOver) slot(entry).all.push(entry);
  for (const entry of entries) slot(entry).entries.push(entry);

  return order
    .map((key) => {
      const group = members.get(key) as {
        label: string;
        entries: FinEntry[];
        all: FinEntry[];
      };
      const posted = group.all.filter(isPosted);
      const receitas = total(
        posted.filter((e) => e.kind === 'receita').map((e) => dec(e.amount)),
      );
      const despesas = total(
        posted.filter((e) => e.kind === 'despesa').map((e) => dec(e.amount)),
      );
      return {
        key,
        label: group.label,
        receitas: money(receitas),
        despesas: money(despesas),
        saldo: money(receitas.minus(despesas)),
        count: group.all.length,
        entries: group.entries,
      };
    })
    .filter((group) => group.entries.length > 0)
    .sort((a, b) => {
      if (by === 'dia') return compareDates(b.key, a.key);
      return (
        dec(b.despesas).plus(b.receitas).comparedTo(dec(a.despesas).plus(a.receitas)) ||
        a.label.localeCompare(b.label, 'pt-BR')
      );
    });
};

export type LedgerPage = {
  readonly entries: readonly FinEntry[];
  readonly next_cursor: string | null;
};

export const encodeCursor = (entry: FinEntry): string =>
  Buffer.from(`${entry.date}|${entry.id}`).toString('base64url');

const decodeCursor = (cursor: string): { date: string; id: string } | null => {
  const [date, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  return date !== undefined && id !== undefined ? { date, id } : null;
};

/** Paginação por cursor sobre a lista já ordenada; os totais não dependem da página (T-06). */
export const paginate = (
  entries: readonly FinEntry[],
  cursor: string | undefined,
  limit: number,
): LedgerPage => {
  const after = cursor === undefined ? null : decodeCursor(cursor);
  const start =
    after === null
      ? 0
      : entries.findIndex(
          (entry) =>
            byLedgerOrder({ ...entry, date: after.date, id: after.id }, entry) < 0,
        );
  const from = start === -1 ? entries.length : start;
  const page = entries.slice(from, from + limit);
  const last = page.at(-1);
  return {
    entries: page,
    next_cursor:
      from + limit < entries.length && last !== undefined ? encodeCursor(last) : null,
  };
};

export const postedTotal = (entries: readonly FinEntry[]): Decimal =>
  entries.filter(isPosted).reduce((acc, entry) => acc.plus(entry.amount), ZERO);
