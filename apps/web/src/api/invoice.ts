import { request } from './client.js';

/** CRT-04 · `GET /api/finance/cards/:id/invoices/:month`. */
export type InvoiceBlock = 'compras' | 'parcelas' | 'creditos' | 'encargos';

export type InvoiceLineResource = {
  readonly id: string;
  readonly origin: 'entry' | 'item';
  readonly block: InvoiceBlock;
  readonly date: string;
  readonly description: string;
  readonly category_id: string | null;
  readonly amount: string;
  readonly installment: { readonly no: number; readonly total: number } | null;
  readonly subtype: string | null;
  readonly forecast: boolean;
};

export type InvoiceResource = {
  readonly card: {
    readonly id: string;
    readonly name: string;
    readonly last4: string;
    readonly pay_account_id: string;
  };
  readonly summary: {
    readonly month: string;
    readonly status: string;
    readonly total: string;
    readonly paid: string;
    readonly remaining: string;
    readonly closing: string;
    readonly due: string;
    readonly overdue: boolean;
  };
  /** Primeiro e último dia de compras da fatura. */
  readonly period: { readonly from: string; readonly to: string };
  readonly lines: readonly InvoiceLineResource[];
  readonly totals: {
    readonly compras: string;
    readonly parcelas: string;
    readonly creditos: string;
    readonly encargos: string;
    readonly total: string;
  };
  readonly payments: readonly {
    readonly id: string;
    readonly date: string;
    readonly account_id: string;
    readonly amount: string;
  }[];
  /** As faturas com movimento, da mais antiga à última prevista. */
  readonly months: readonly string[];
};

export const fetchInvoice = (
  cardId: string,
  month: string,
  signal?: AbortSignal,
): Promise<InvoiceResource> =>
  request(
    `/api/finance/cards/${encodeURIComponent(cardId)}/invoices/${encodeURIComponent(month)}`,
    { parse: (value: unknown) => value as InvoiceResource },
    signal === undefined ? {} : { signal },
  );
