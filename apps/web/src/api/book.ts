import { bookResponseSchema } from '@patrimonio/contracts';
import type { BookResponse } from '@patrimonio/contracts';

import { request } from './client.js';

/**
 * LAN-01 · O livro do período: `GET /api/finance/book`.
 *
 * Filtros e totais ficam na `api` — quem filtra é quem soma (RN-U16) —, então a
 * faixa de cima e a soma da coluna Valor leem o mesmo conjunto de linhas.
 */
export type BookQuery = {
  readonly month?: string;
  readonly from?: string;
  readonly to?: string;
  readonly tipo?: readonly string[];
  readonly situacao?: readonly string[];
  readonly conta?: readonly string[];
  readonly cartao?: readonly string[];
  readonly carteira?: readonly string[];
  readonly categoria?: readonly string[];
  readonly q?: string;
  readonly groupBy?: 'dia' | 'tipo' | 'conta_carteira';
  readonly cursor?: string;
  readonly limit?: number;
};

export const bookSearch = (query: BookQuery): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else if (value !== '') {
      params.set(key, String(value));
    }
  }
  return params;
};

export const fetchBook = (
  query: BookQuery,
  signal?: AbortSignal,
): Promise<BookResponse> =>
  request(
    `/api/finance/book?${bookSearch(query).toString()}`,
    bookResponseSchema,
    signal === undefined ? {} : { signal },
  );

/**
 * LAN-02/LAN-06 · "Lançar" um previsto, com data e valor reais opcionais.
 * Sem corpo, confirma na data e valor previstos. Cada tentativa leva uma
 * `Idempotency-Key` nova: confirmar duas vezes a mesma não duplica efeito.
 */
export const confirmPlanned = (
  entryId: string,
  actual: { readonly date?: string; readonly amount?: string } = {},
): Promise<unknown> =>
  request(
    `/api/finance/entries/${entryId}/confirm`,
    { parse: (v: unknown) => v },
    {
      method: 'POST',
      body: JSON.stringify(actual),
      headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() },
    },
  );

/** Nomes das contas, para a coluna Detalhe dizer "de Nubank Conta". */
export const fetchAccountNames = async (
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string>> => {
  const body = await request(
    '/api/finance/accounts',
    {
      parse: (v: unknown) =>
        v as { accounts?: readonly { account: { id: string; name: string } }[] },
    },
    signal === undefined ? {} : { signal },
  );
  return new Map((body.accounts ?? []).map((row) => [row.account.id, row.account.name]));
};

const accept = { parse: (v: unknown): unknown => v };

/** LAN-08 · Exclui uma linha pela rota do tipo dela (`deletePath`). */
export const deleteBookRow = (path: string): Promise<unknown> =>
  request(path, accept, {
    method: 'DELETE',
    headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() },
  });

/** LAN-08 · Grava o lançamento já com a troca de categoria ou de conta. */
export const putFinanceEntry = (
  id: string,
  body: Record<string, unknown>,
): Promise<unknown> =>
  request(`/api/finance/entries/${id}`, accept, {
    method: 'PUT',
    headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() },
    body: JSON.stringify(body),
  });

export type CategoryOption = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
};

export const fetchCategoryOptions = async (
  signal?: AbortSignal,
): Promise<readonly CategoryOption[]> => {
  const body = await request(
    '/api/finance/categories',
    {
      parse: (v: unknown) =>
        v as { categories?: readonly (CategoryOption & { archived?: boolean })[] },
    },
    signal === undefined ? {} : { signal },
  );
  return (body.categories ?? []).filter((c) => c.archived !== true);
};

/** LAN-07 · Mover um lançamento de cartão para a fatura de outro mês (`AAAA-MM`). */
export const moveEntryInvoice = (id: string, invoiceMonth: string): Promise<unknown> =>
  request(`/api/finance/entries/${id}/invoice`, accept, {
    method: 'POST',
    headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() },
    body: JSON.stringify({ invoice_month: invoiceMonth }),
  });

/** LAN-07 · Estornar: um crédito `estorno` na fatura do cartão, ligado ao lançamento. */
export const reverseCardEntry = (
  cardId: string,
  body: {
    readonly invoice_month: string;
    readonly description: string;
    readonly amount: string;
    readonly reverses_id: string;
  },
): Promise<unknown> =>
  request(`/api/finance/cards/${cardId}/items`, accept, {
    method: 'POST',
    headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() },
    body: JSON.stringify({ kind: 'credito', subtype: 'estorno', ...body }),
  });
