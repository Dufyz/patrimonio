import type { EntryRequest } from '../lib/ledger_entry_form.js';
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
  readonly invoices?: readonly {
    readonly name: string;
    readonly month: string;
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
  req: EntryRequest,
  signal?: AbortSignal,
): Promise<{ readonly effect: EffectResource }> =>
  request(`${req.path}?preview=true`, as<{ effect: EffectResource }>(), {
    method: 'POST',
    body: JSON.stringify(req.body),
    ...(signal === undefined ? {} : { signal }),
  });

export const saveEntry = (req: EntryRequest, idempotencyKey: string): Promise<unknown> =>
  request(req.path, as<unknown>(), {
    method: 'POST',
    body: JSON.stringify(req.body),
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

export type CardOption = {
  readonly id: string;
  readonly name: string;
  readonly payAccountId: string;
  /** A fatura vigente: o mês, a situação e o que falta pagar. */
  readonly month: string;
  readonly status: 'prevista' | 'aberta' | 'fechada' | 'parcial' | 'paga';
  readonly remaining: string;
};

export const fetchCards = async (
  signal?: AbortSignal,
): Promise<readonly CardOption[]> => {
  const body = await request(
    '/api/finance/cards',
    as<{
      cards: readonly {
        card: { id: string; name: string; pay_account_id: string };
        invoice: { month: string; status: CardOption['status']; remaining: string };
      }[];
    }>(),
    signal === undefined ? {} : { signal },
  );
  return body.cards.map((c) => ({
    id: c.card.id,
    name: c.card.name,
    payAccountId: c.card.pay_account_id,
    month: c.invoice.month,
    status: c.invoice.status,
    remaining: c.invoice.remaining,
  }));
};
