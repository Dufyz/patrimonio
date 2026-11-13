import { request } from './client.js';

/** CRT-08 · Escrita de cartões: criar, editar e arquivar. */
export type CardRequest = {
  readonly name: string;
  readonly last4?: string;
  readonly pay_account_id: string;
  readonly limit_amount: string;
  readonly closing_day: number;
  readonly due_day: number;
};

const raw = { parse: (value: unknown) => value };
const send = (
  path: string,
  method: 'POST' | 'PUT',
  body: unknown,
  key: string,
): Promise<unknown> =>
  request(path, raw, {
    method,
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': key },
  });

export const createCard = (body: CardRequest, key: string): Promise<unknown> =>
  send('/api/finance/cards', 'POST', body, key);

export const updateCard = (
  id: string,
  body: CardRequest,
  key: string,
): Promise<unknown> =>
  send(`/api/finance/cards/${encodeURIComponent(id)}`, 'PUT', body, key);

export const setCardArchived = (
  id: string,
  archived: boolean,
  key: string,
): Promise<unknown> =>
  send(`/api/finance/cards/${encodeURIComponent(id)}/archive`, 'POST', { archived }, key);
