import { request } from './client.js';

/** CRT-03 · `GET /api/finance/cards/:id`. */
export type CardInvoiceRowResource = {
  readonly month: string;
  readonly status: string;
  readonly total: string;
  readonly paid: string;
  readonly remaining: string;
  readonly closing: string;
  readonly due: string;
  readonly overdue: boolean;
  readonly from: string;
  readonly to: string;
  readonly payments: readonly {
    readonly date: string;
    readonly account_id: string;
    readonly amount: string;
  }[];
};

export type CardDetailResource = {
  readonly summary: {
    readonly card: {
      readonly id: string;
      readonly name: string;
      readonly last4: string;
      readonly pay_account_id: string;
      readonly limit_amount: string;
      readonly closing_day: number;
      readonly due_day: number;
    };
    readonly used: string;
    readonly used_percent: number;
    readonly available: string;
  };
  readonly limit: {
    readonly used: string;
    readonly available: string;
    readonly percent: number;
  };
  readonly as_of: string;
  readonly invoices: readonly CardInvoiceRowResource[];
  readonly installments: readonly {
    readonly description: string;
    readonly origin: string;
    readonly current: number;
    readonly total: number;
    readonly amount: string;
    readonly remaining: string;
  }[];
  readonly planned_payments: readonly {
    readonly month: string;
    readonly due: string;
    readonly amount: string;
    readonly status: string;
    readonly account_id: string;
  }[];
  /** O mês da fatura aberta. */
  readonly open_month: string;
  readonly open_invoice_categories: readonly {
    readonly category_id: string | null;
    readonly name: string;
    readonly amount: string;
    readonly percent: number;
  }[];
  /** Média das cinco últimas faturas fechadas; nulo sem nenhuma. */
  readonly average_closed: string | null;
  readonly future_parts: readonly {
    readonly month: string;
    readonly description: string;
    readonly no: number;
    readonly total: number;
    readonly amount: string;
  }[];
  readonly future_total: string;
};

export const fetchCardDetail = (
  id: string,
  signal?: AbortSignal,
): Promise<CardDetailResource> =>
  request(
    `/api/finance/cards/${encodeURIComponent(id)}`,
    { parse: (value: unknown) => value as CardDetailResource },
    signal === undefined ? {} : { signal },
  );
