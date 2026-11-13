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

/** LAN-02 · "Lançar" um previsto: confirma o lançamento na data e valor previstos. */
export const confirmPlanned = (entryId: string): Promise<unknown> =>
  request(
    `/api/finance/entries/${entryId}/confirm`,
    { parse: (v: unknown) => v },
    {
      method: 'POST',
      body: '{}',
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
