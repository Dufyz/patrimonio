import type { CardRequest } from '../api/card_write.js';

/** CRT-08 · O formulário de cartão: o que valida e o pedido que monta. */
export type CardDraft = {
  readonly name: string;
  readonly last4: string;
  readonly limit: string;
  readonly closingDay: string;
  readonly dueDay: string;
  readonly payAccountId: string;
};

export const newCardDraft = (payAccountId = ''): CardDraft => ({
  name: '',
  last4: '',
  limit: '',
  closingDay: '',
  dueDay: '',
  payAccountId,
});

export type CardErrors = Partial<Record<keyof CardDraft, string>>;

const normalize = (v: string): string => v.trim().replace(/\./g, '').replace(',', '.');
const validDay = (v: string): boolean =>
  /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 31;

export const validateCard = (draft: CardDraft, others: readonly string[]): CardErrors => {
  const errors: CardErrors = {};
  const name = draft.name.trim();
  if (name === '') errors.name = 'Informe o nome do cartão.';
  else if (others.some((n) => n.trim().toLowerCase() === name.toLowerCase()))
    errors.name = 'Já existe um cartão com esse nome.';
  if (draft.last4 !== '' && !/^\d{4}$/.test(draft.last4))
    errors.last4 = 'Use os 4 últimos dígitos.';
  if (!/^\d+(\.\d{1,2})?$/.test(normalize(draft.limit)))
    errors.limit = 'Informe o limite.';
  if (!validDay(draft.closingDay)) errors.closingDay = 'Dia de 1 a 31.';
  if (!validDay(draft.dueDay)) errors.dueDay = 'Dia de 1 a 31.';
  if (draft.payAccountId === '')
    errors.payAccountId = 'Escolha a conta que paga a fatura.';
  return errors;
};

export const toCardRequest = (draft: CardDraft): CardRequest => ({
  name: draft.name.trim(),
  ...(draft.last4 === '' ? {} : { last4: draft.last4 }),
  pay_account_id: draft.payAccountId,
  limit_amount: normalize(draft.limit),
  closing_day: Number(draft.closingDay),
  due_day: Number(draft.dueDay),
});
