import type { FinSnapshot } from '@patrimonio/domain';

/**
 * O que mudou entre dois snapshots, por tabela: linhas novas ou alteradas
 * (`upserts`) e ids removidos (`deletes`). É assim que "função pura sobre o
 * snapshot" vira escrita: o caso de uso calcula o snapshot novo e grava só a
 * diferença, numa única transação.
 */

export type TableChange<T> = {
  readonly upserts: readonly T[];
  readonly deletes: readonly string[];
};

export type FinChanges = {
  readonly categories: TableChange<FinSnapshot['categories'][number]>;
  readonly accounts: TableChange<FinSnapshot['accounts'][number]>;
  readonly cards: TableChange<FinSnapshot['cards'][number]>;
  readonly recurrings: TableChange<FinSnapshot['recurrings'][number]>;
  readonly skips: TableChange<FinSnapshot['skips'][number]>;
  readonly entries: TableChange<FinSnapshot['entries'][number]>;
  readonly movements: TableChange<FinSnapshot['movements'][number]>;
  readonly card_items: TableChange<FinSnapshot['card_items'][number]>;
  readonly invoice_payments: TableChange<FinSnapshot['invoice_payments'][number]>;
};

const diffTable = <T>(
  before: readonly T[],
  after: readonly T[],
  keyOf: (row: T) => string,
): TableChange<T> => {
  const previous = new Map(
    before.map((row) => [keyOf(row), JSON.stringify(row)] as const),
  );
  const upserts = after.filter((row) => previous.get(keyOf(row)) !== JSON.stringify(row));
  const kept = new Set(after.map(keyOf));
  const deletes = [...previous.keys()].filter((key) => !kept.has(key));
  return { upserts, deletes };
};

const skipKey = (skip: { recurring_id: string; month: string }): string =>
  `${skip.recurring_id}|${skip.month}`;

export const diffSnapshots = (before: FinSnapshot, after: FinSnapshot): FinChanges => ({
  categories: diffTable(before.categories, after.categories, (r) => r.id),
  accounts: diffTable(before.accounts, after.accounts, (r) => r.id),
  cards: diffTable(before.cards, after.cards, (r) => r.id),
  recurrings: diffTable(before.recurrings, after.recurrings, (r) => r.id),
  skips: diffTable(before.skips, after.skips, skipKey),
  entries: diffTable(before.entries, after.entries, (r) => r.id),
  movements: diffTable(before.movements, after.movements, (r) => r.id),
  card_items: diffTable(before.card_items, after.card_items, (r) => r.id),
  invoice_payments: diffTable(
    before.invoice_payments,
    after.invoice_payments,
    (r) => r.id,
  ),
});

export const isEmptyChange = (changes: FinChanges): boolean =>
  Object.values(changes).every(
    (table) => table.upserts.length === 0 && table.deletes.length === 0,
  );

export { skipKey };
