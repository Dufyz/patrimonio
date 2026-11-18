import { request } from './client.js';

/** CRT-01 · `GET /api/finance/cards`: cartões com dívida e o resumo de Livre após faturas. */
export type CardRowResource = {
  readonly card: {
    readonly id: string;
    readonly name: string;
    readonly last4: string;
    readonly pay_account_id: string;
    readonly limit_amount: string;
    readonly closing_day: number;
    readonly due_day: number;
  };
  readonly invoice: {
    readonly month: string;
    readonly status: string;
    readonly total: string;
    readonly remaining: string;
    readonly due: string;
    readonly overdue: boolean;
  };
  readonly used: string;
  readonly used_percent: number;
  readonly available: string;
  /** O limite pelo que se deve: faturas abertas mais fechadas a pagar. */
  readonly limit: {
    readonly used: string;
    readonly available: string;
    readonly percent: number;
  };
  readonly days_to_due: number;
  readonly debt: {
    readonly abertas: string;
    readonly fechadas_a_pagar: string;
    readonly next_due: string | null;
    /** Aberta + fechada a pagar. */
    readonly total: string;
  };
  /** As faturas do cartão, da mais distante à mais antiga. */
  readonly invoices: readonly OverviewInvoiceResource[];
};

export type OverviewInvoiceResource = {
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
};

export type OverviewInstallmentResource = {
  readonly description: string;
  readonly current: number;
  readonly total: number;
  readonly amount: string;
  readonly remaining: string;
  readonly card_id: string;
};

export type UpcomingRowResource = {
  readonly month: string;
  readonly status: string;
  readonly cells: readonly { readonly card_id: string; readonly amount: string | null }[];
  readonly total: string;
};

export type CardsResource = {
  readonly cards: readonly CardRowResource[];
  readonly upcoming: readonly UpcomingRowResource[];
  readonly open_total: string;
  readonly as_of: string;
  readonly wealth: {
    readonly em_contas: string;
    readonly abertas: string;
    readonly fechadas_a_pagar: string;
    readonly total_devido: string;
    readonly livre: string;
    readonly falta: string;
  };
  readonly summary: {
    readonly closed_count: number;
    readonly closed_first_due: string | null;
    readonly open_count: number;
    readonly open_dues: readonly string[];
    readonly limit_total: string;
    readonly limit_available: string;
    readonly limit_used_percent: number;
  };
  readonly planned_payments: readonly {
    readonly month: string;
    readonly due: string;
    readonly amount: string;
    readonly status: string;
    readonly account_id: string;
    readonly card_id: string;
  }[];
  readonly planned_total: string;
  readonly installments: readonly OverviewInstallmentResource[];
  readonly installments_total: string;
};

export const fetchCardsOverview = (signal?: AbortSignal): Promise<CardsResource> =>
  request(
    '/api/finance/cards',
    { parse: (value: unknown) => value as CardsResource },
    signal === undefined ? {} : { signal },
  );
