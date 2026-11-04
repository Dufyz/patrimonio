import type { IsoDate } from '../lib/dates.js';
import { parseMoneyInput } from '../lib/format.js';
import type { CardItemDraft } from './card_item_ops.js';
import { paymentsOf } from './entry_ops.js';
import type { EntryDraft } from './entry_ops.js';
import type { CardItem, Entry, FinanceData } from './types.js';

/**
 * FIN-510 · Editar ou excluir uma compra parcelada pergunta se vale para todas
 * as parcelas ou só para as futuras (a escolhida e as seguintes).
 */

export type InstallmentScope = 'todas' | 'futuras';

type Group = { readonly of: number; readonly origin: IsoDate | undefined };

const entryGroup = (entry: Entry): Group | null =>
  entry.installment === undefined
    ? null
    : { of: entry.installment.of, origin: entry.installment.origin };

const itemGroup = (item: CardItem): Group | null =>
  item.installment === undefined
    ? null
    : { of: item.installment.of, origin: item.installment.origin };

const sameGroup = (a: Group | null, b: Group | null): boolean =>
  a !== null && b !== null && a.of === b.of && a.origin === b.origin;

const inScope = (n: number, from: number, scope: InstallmentScope): boolean =>
  scope === 'todas' || n >= from;

/** As parcelas de uma compra de Lançamentos atingidas pelo escopo. */
export const entryTargets = (
  data: FinanceData,
  id: string,
  scope: InstallmentScope,
): readonly Entry[] => {
  const base = data.entries.find((entry) => entry.id === id);
  const group = base === undefined ? null : entryGroup(base);
  if (base === undefined || base.installment === undefined || group === null) return [];
  const from = base.installment.n;
  return data.entries.filter(
    (entry) =>
      entry.description === base.description &&
      sameGroup(entryGroup(entry), group) &&
      inScope(entry.installment?.n ?? 0, from, scope),
  );
};

/** As parcelas de um item só da fatura atingidas pelo escopo. */
export const itemTargets = (
  data: FinanceData,
  id: string,
  scope: InstallmentScope,
): readonly CardItem[] => {
  const base = data.cardItems.find((item) => item.id === id);
  const group = base === undefined ? null : itemGroup(base);
  if (base === undefined || base.installment === undefined || group === null) return [];
  const from = base.installment.n;
  return data.cardItems.filter(
    (item) =>
      item.cardId === base.cardId &&
      item.description === base.description &&
      sameGroup(itemGroup(item), group) &&
      inScope(item.installment?.n ?? 0, from, scope),
  );
};

export const deleteInstallments = (
  data: FinanceData,
  origin: 'entry' | 'item',
  id: string,
  scope: InstallmentScope,
): FinanceData => {
  if (origin === 'entry') {
    const ids = new Set(entryTargets(data, id, scope).map((entry) => entry.id));
    return ids.size === 0
      ? data
      : { ...data, entries: data.entries.filter((entry) => !ids.has(entry.id)) };
  }
  const ids = new Set(itemTargets(data, id, scope).map((item) => item.id));
  return ids.size === 0
    ? data
    : { ...data, cardItems: data.cardItems.filter((item) => !ids.has(item.id)) };
};

/** Descrição, categoria, valor e origem passam para as parcelas do escopo; as datas ficam. */
export const updateInstallmentEntries = (
  data: FinanceData,
  id: string,
  draft: EntryDraft,
  scope: InstallmentScope,
): FinanceData => {
  const ids = new Set(entryTargets(data, id, scope).map((entry) => entry.id));
  const cents = parseMoneyInput(draft.value);
  if (ids.size === 0 || cents === null || cents <= 0) return data;
  return {
    ...data,
    entries: data.entries.map((entry) =>
      ids.has(entry.id)
        ? {
            ...entry,
            description: draft.description.trim(),
            categoryId: draft.categoryId,
            cents,
            payments: paymentsOf(draft),
          }
        : entry,
    ),
  };
};

export const updateInstallmentItems = (
  data: FinanceData,
  id: string,
  draft: CardItemDraft,
  scope: InstallmentScope,
): FinanceData => {
  const ids = new Set(itemTargets(data, id, scope).map((item) => item.id));
  const cents = parseMoneyInput(draft.value);
  if (ids.size === 0 || cents === null || cents <= 0) return data;
  return {
    ...data,
    cardItems: data.cardItems.map((item) =>
      ids.has(item.id)
        ? {
            ...item,
            description: draft.description.trim(),
            cents,
            ...(draft.categoryId === '' ? {} : { categoryId: draft.categoryId }),
          }
        : item,
    ),
  };
};
