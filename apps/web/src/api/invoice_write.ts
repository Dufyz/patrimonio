import { request } from './client.js';

/** CRT-07 · Estorno, crédito, encargo, mover de fatura e excluir linha. */
export type CardItemRequest = {
  readonly kind: 'credito' | 'encargo';
  readonly subtype:
    | 'devolucao'
    | 'estorno'
    | 'desconto'
    | 'cashback'
    | 'juros'
    | 'multa'
    | 'iof'
    | 'anuidade';
  readonly invoice_month: string;
  readonly description: string;
  readonly amount: string;
  readonly category_id?: string | undefined;
  readonly reverses_id?: string | undefined;
};

const raw = { parse: (value: unknown) => value };
const post = (path: string, body: unknown, key: string): Promise<unknown> =>
  request(path, raw, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': key },
  });

export const addCardItem = (
  cardId: string,
  body: CardItemRequest,
  key: string,
): Promise<unknown> =>
  post(`/api/finance/cards/${encodeURIComponent(cardId)}/items`, body, key);

export const moveLine = (
  origin: 'entry' | 'item',
  id: string,
  month: string,
  key: string,
): Promise<unknown> =>
  post(
    origin === 'entry'
      ? `/api/finance/entries/${encodeURIComponent(id)}/invoice`
      : `/api/finance/card-items/${encodeURIComponent(id)}/invoice`,
    { invoice_month: month },
    key,
  );

export const deleteLine = (
  origin: 'entry' | 'item',
  id: string,
  installment: boolean,
  key: string,
): Promise<unknown> =>
  request(
    origin === 'entry'
      ? `/api/finance/entries/${encodeURIComponent(id)}${installment ? '?scope=esta' : ''}`
      : `/api/finance/card-items/${encodeURIComponent(id)}`,
    raw,
    { method: 'DELETE', headers: { 'Idempotency-Key': key } },
  );

/** CRT-06 · Excluir o pagamento devolve o saldo à conta e reabre a fatura. */
export const deletePayment = (paymentId: string, key: string): Promise<unknown> =>
  request(`/api/finance/payments/${encodeURIComponent(paymentId)}`, raw, {
    method: 'DELETE',
    headers: { 'Idempotency-Key': key },
  });
