import type { EntryBody } from '@patrimonio/contracts';

import { request } from './client.js';

/**
 * LAN-09 · Escrita do livro: `POST /api/finance/entries`, com `?preview=true`
 * para o bloco "Efeito" e `Idempotency-Key` por tentativa de submissão.
 */
export type EffectResource = {
  readonly accounts: readonly {
    readonly account_id: string;
    readonly name: string;
    readonly before: string;
    readonly after: string;
  }[];
  readonly months: readonly {
    readonly month: string;
    readonly receitas_before: string;
    readonly receitas_after: string;
    readonly despesas_before: string;
    readonly despesas_after: string;
  }[];
  readonly warnings: readonly { readonly message?: string }[];
};

type Parsed<T> = { readonly parse: (value: unknown) => T };
const as = <T>(): Parsed<T> => ({ parse: (value) => value as T });

export const previewEntry = (
  body: EntryBody,
  signal?: AbortSignal,
): Promise<{ readonly effect: EffectResource }> =>
  request('/api/finance/entries?preview=true', as<{ effect: EffectResource }>(), {
    method: 'POST',
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });

export const saveEntry = (body: EntryBody, idempotencyKey: string): Promise<unknown> =>
  request('/api/finance/entries', as<unknown>(), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export type CategoryOption = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'receita' | 'despesa';
};

export const fetchCategories = async (
  signal?: AbortSignal,
): Promise<readonly CategoryOption[]> =>
  (
    await request(
      '/api/finance/categories',
      as<{ categories: readonly CategoryOption[] }>(),
      signal === undefined ? {} : { signal },
    )
  ).categories;
