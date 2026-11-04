import type { IsoDate } from '../lib/dates.js';
import { parseMoneyInput } from '../lib/format.js';
import { invoiceKeyOf, paymentOf } from './cards.js';
import type { CardItem, CreditType, FinanceData } from './types.js';

/**
 * Itens que só a fatura tem (RN-46): compras resumidas, créditos e encargos.
 * Fatura paga é somente leitura (RN-53).
 */

export type CardItemDraft = {
  readonly description: string;
  readonly date: IsoDate;
  readonly categoryId: string;
  readonly value: string;
};

export type CardItemErrors = Partial<
  Record<'description' | 'date' | 'categoryId' | 'value', string>
>;

export const draftOfCardItem = (item: CardItem): CardItemDraft => ({
  description: item.description,
  date: item.date,
  categoryId: item.categoryId ?? '',
  value: (item.cents / 100).toFixed(2).replace('.', ','),
});

/** A fatura em que o item cai. */
export const itemInvoice = (data: FinanceData, item: CardItem): string => {
  const card = data.cards.find((c) => c.id === item.cardId);
  return item.invoice ?? (card === undefined ? '' : invoiceKeyOf(card, item.date));
};

export const itemLocked = (data: FinanceData, item: CardItem): boolean =>
  paymentOf(data, item.cardId, itemInvoice(data, item)) !== undefined;

export const validateCardItem = (
  draft: CardItemDraft,
  needsCategory: boolean,
): CardItemErrors => {
  const errors: Record<string, string> = {};
  if (draft.description.trim() === '') errors['description'] = 'Dê uma descrição.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors['date'] = 'Informe a data.';
  if (needsCategory && draft.categoryId === '')
    errors['categoryId'] = 'Escolha a categoria.';
  const value = parseMoneyInput(draft.value);
  if (value === null || value <= 0) errors['value'] = 'Informe um valor maior que zero.';
  return errors;
};

export const updateCardItem = (
  data: FinanceData,
  id: string,
  draft: CardItemDraft,
): FinanceData => {
  const current = data.cardItems.find((item) => item.id === id);
  if (current === undefined || itemLocked(data, current)) return data;
  if (Object.keys(validateCardItem(draft, current.categoryId !== undefined)).length > 0)
    return data;
  return {
    ...data,
    cardItems: data.cardItems.map((item) =>
      item.id === id
        ? {
            ...item,
            description: draft.description.trim(),
            date: draft.date,
            cents: parseMoneyInput(draft.value) ?? item.cents,
            ...(draft.categoryId === '' ? {} : { categoryId: draft.categoryId }),
          }
        : item,
    ),
  };
};

export const deleteCardItem = (data: FinanceData, id: string): FinanceData => {
  const current = data.cardItems.find((item) => item.id === id);
  if (current === undefined || itemLocked(data, current)) return data;
  return { ...data, cardItems: data.cardItems.filter((item) => item.id !== id) };
};

export type CreditDraft = CardItemDraft & { readonly subtype: CreditType };

export const emptyCreditDraft = (today: IsoDate): CreditDraft => ({
  subtype: 'devolucao',
  description: '',
  date: today,
  categoryId: '',
  value: '',
});

export const CREDIT_TYPES: readonly { readonly id: CreditType; readonly name: string }[] =
  [
    { id: 'devolucao', name: 'Devolução' },
    { id: 'estorno', name: 'Estorno' },
    { id: 'desconto', name: 'Desconto' },
    { id: 'cashback', name: 'Cashback' },
  ];

/** FIN-508 · Crédito na fatura exibida: abate o total, nunca é receita (RN-51). */
export const addCredit = (
  data: FinanceData,
  cardId: string,
  invoice: string,
  draft: CreditDraft,
): FinanceData => {
  if (paymentOf(data, cardId, invoice) !== undefined) return data;
  if (Object.keys(validateCardItem(draft, true)).length > 0) return data;
  const id = `credit-${cardId}-${invoice}-${data.cardItems.length + 1}`;
  const item: CardItem = {
    id,
    cardId,
    kind: 'credito',
    date: draft.date,
    description: draft.description.trim(),
    categoryId: draft.categoryId,
    cents: parseMoneyInput(draft.value) ?? 0,
    subtype: draft.subtype,
    invoice,
  };
  return { ...data, cardItems: [...data.cardItems, item] };
};
