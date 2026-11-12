import { parseMoneyInput } from '../lib/format.js';
import { normalizeText } from '../lib/text.js';
import type { Card, FinanceData } from './types.js';

/**
 * FIN-503 · Novo cartão e editar cartão (RN-40). Um cartão pertence a uma só
 * conta, que paga a fatura. Alterar a conta ou os dias vale para as faturas
 * ainda não pagas, porque o período e o pagador são calculados do cadastro.
 */

export type CardDraft = {
  readonly name: string;
  readonly last4: string;
  readonly payerId: string;
  readonly limit: string;
  readonly closingDay: string;
  readonly dueDay: string;
};

export type CardErrors = Partial<
  Record<'name' | 'last4' | 'payerId' | 'limit' | 'closingDay' | 'dueDay', string>
>;

export const emptyCardDraft = (payerId = ''): CardDraft => ({
  name: '',
  last4: '',
  payerId,
  limit: '',
  closingDay: '',
  dueDay: '',
});

export const draftOfCard = (card: Card): CardDraft => ({
  name: card.name,
  last4: card.last4,
  payerId: card.payerId,
  limit: (card.limitCents / 100).toFixed(2).replace('.', ','),
  closingDay: String(card.closingDay),
  dueDay: String(card.dueDay),
});

const validDay = (text: string): boolean => {
  const day = Number(text);
  return /^\d+$/.test(text) && day >= 1 && day <= 31;
};

export const validateCard = (
  data: FinanceData,
  draft: CardDraft,
  editingId?: string,
): CardErrors => {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (name === '') errors['name'] = 'Dê um nome.';
  else if (
    data.cards.some(
      (card) => card.id !== editingId && normalizeText(card.name) === normalizeText(name),
    )
  ) {
    errors['name'] = 'Já existe um cartão com esse nome.';
  }
  if (!/^\d{4}$/.test(draft.last4)) errors['last4'] = 'Informe os 4 últimos dígitos.';
  if (!data.accounts.some((a) => a.id === draft.payerId && a.type === 'conta'))
    errors['payerId'] = 'Escolha a conta que paga a fatura.';
  const limit = parseMoneyInput(draft.limit);
  if (limit === null || limit <= 0) errors['limit'] = 'Informe o limite.';
  if (!validDay(draft.closingDay)) errors['closingDay'] = 'Informe um dia de 1 a 31.';
  if (!validDay(draft.dueDay)) errors['dueDay'] = 'Informe um dia de 1 a 31.';
  return errors;
};

const slug = (name: string): string =>
  normalizeText(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const cardFields = (draft: CardDraft): Omit<Card, 'id'> => ({
  name: draft.name.trim(),
  last4: draft.last4,
  payerId: draft.payerId,
  limitCents: parseMoneyInput(draft.limit) ?? 0,
  closingDay: Number(draft.closingDay),
  dueDay: Number(draft.dueDay),
});

export const addCard = (data: FinanceData, draft: CardDraft): FinanceData => {
  if (Object.keys(validateCard(data, draft)).length > 0) return data;
  const base = slug(draft.name) || 'cartao';
  const ids = new Set([
    ...data.cards.map((c) => c.id),
    ...data.accounts.map((a) => a.id),
  ]);
  let id = base;
  for (let n = 2; ids.has(id); n += 1) id = `${base}-${n}`;
  return { ...data, cards: [...data.cards, { id, ...cardFields(draft) }] };
};

export const updateCard = (
  data: FinanceData,
  id: string,
  draft: CardDraft,
): FinanceData => {
  if (Object.keys(validateCard(data, draft, id)).length > 0) return data;
  return {
    ...data,
    cards: data.cards.map((card) =>
      card.id === id ? { id, ...cardFields(draft) } : card,
    ),
  };
};
