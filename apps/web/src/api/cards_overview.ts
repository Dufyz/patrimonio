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
  readonly days_to_due: number;
  readonly debt: {
    readonly abertas: string;
    readonly fechadas_a_pagar: string;
    readonly next_due: string | null;
  };
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
};

export const fetchCardsOverview = (signal?: AbortSignal): Promise<CardsResource> =>
  request(
    '/api/finance/cards',
    { parse: (value: unknown) => value as CardsResource },
    signal === undefined ? {} : { signal },
  );
