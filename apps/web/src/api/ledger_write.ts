import type { EntryRequest } from '../lib/ledger_entry_form.js';
import { request } from './client.js';

/**
 * LAN-09 · Escrita do livro: `POST /api/finance/entries`, com `?preview=true`
 * para o bloco "Efeito" e `Idempotency-Key` por tentativa de submissão.
 */
export type EffectResource = {
  readonly wealth?: {
    readonly em_contas: { readonly before: string; readonly after: string };
    readonly total_devido: { readonly before: string; readonly after: string };
    readonly livre: { readonly before: string; readonly after: string };
    readonly falta: { readonly before: string; readonly after: string };
  };
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

type BeforeAfter = { readonly before: string; readonly after: string };

/** O que o preview devolve: o efeito de Finanças ou o de aporte/resgate (conta e posição). */
export type PreviewResponse = {
  /** Provento: o que a api calculou na data-com. */
  readonly gross_amount?: string;
  readonly net_amount?: string;
  /** Evento: o efeito por carteira. */
  readonly portfolios?: readonly {
    readonly portfolio_name: string;
    readonly quantity: { readonly before: string; readonly after: string };
    readonly avg_price: { readonly before: string; readonly after: string };
    readonly cost_basis: { readonly before: string; readonly after: string };
  }[];
  readonly effect?: EffectResource;
  readonly account?: {
    readonly account_id: string;
    readonly before: string;
    readonly after: string;
  } | null;
  readonly position?: {
    readonly quantity: BeforeAfter;
    readonly avg_price: BeforeAfter;
    readonly cost_basis: BeforeAfter;
  } | null;
};

export const previewEntry = (
  req: EntryRequest,
  signal?: AbortSignal,
): Promise<PreviewResponse> =>
  request(
    req.preview === undefined ? `${req.path}?preview=true` : req.preview.path,
    as<PreviewResponse>(),
    {
      method: 'POST',
      body: JSON.stringify(req.preview?.body ?? req.body),
      ...(signal === undefined ? {} : { signal }),
    },
  );

export const saveEntry = async (
  req: EntryRequest,
  idempotencyKey: string,
): Promise<unknown> => {
  const saved = await request(req.path, as<{ event?: { id?: string } }>(), {
    method: 'POST',
    body: JSON.stringify(req.body),
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  // Registrar um evento não o aplica: confirmar é o que ajusta a posição.
  const eventId = saved.event?.id;
  if (req.confirmEvent === true && eventId !== undefined) {
    await request(`/api/corporate-events/${eventId}/confirm`, as<unknown>(), {
      method: 'POST',
      body: '{}',
    });
  }
  return saved;
};

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
