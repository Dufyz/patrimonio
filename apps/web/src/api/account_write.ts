import { request } from './client.js';

/** CTA-05/CTA-06 · Escrita de contas: criar, editar, arquivar e reativar. */
export type AccountRequest = {
  readonly name: string;
  readonly type: 'corrente' | 'poupanca' | 'carteira';
  readonly institution: string | null;
  readonly role: string;
  readonly role_tag: string | null;
  readonly opening_amount: string;
  readonly opening_date: string;
  readonly in_wealth: boolean;
};

const raw = { parse: (value: unknown) => value };

export const createAccount = (body: AccountRequest, key: string): Promise<unknown> =>
  request('/api/finance/accounts', raw, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': key },
  });

export const updateAccount = (
  id: string,
  body: AccountRequest,
  key: string,
): Promise<unknown> =>
  request(`/api/finance/accounts/${encodeURIComponent(id)}`, raw, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': key },
  });

export const setAccountArchived = (
  id: string,
  archived: boolean,
  key: string,
): Promise<unknown> =>
  request(`/api/finance/accounts/${encodeURIComponent(id)}/archive`, raw, {
    method: 'POST',
    body: JSON.stringify({ archived }),
    headers: { 'Idempotency-Key': key },
  });
