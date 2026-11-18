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
  readonly reversed: boolean;
  readonly moved: boolean;
  /** O total da fatura até esta linha, em ordem de data. */
  readonly accumulated: string;
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
  /** As faturas sem pagamento: só elas aceitam estorno, mover, crédito e encargo. */
  readonly unpaid_months: readonly string[];
  /** As faturas do seletor do cabeçalho, da mais recente à mais antiga. */
  readonly invoices: readonly {
    readonly month: string;
    readonly status: string;
    readonly total: string;
  }[];
  readonly limit: {
    readonly total: string;
    readonly used: string;
    readonly available: string;
    readonly percent: number;
  };
  readonly purchases: {
    readonly count: number;
    readonly from: string | null;
    readonly to: string | null;
  };
  readonly largest_category: {
    readonly name: string;
    readonly amount: string;
    readonly percent: number;
  } | null;
  /** O pagamento previsto: a própria fatura, se fechada, ou a fechada mais antiga. */
  readonly payable: {
    readonly summary: InvoiceResource['summary'];
    readonly period: { readonly from: string; readonly to: string };
    readonly preview: {
      readonly due: string;
      readonly em_contas: BeforeAfter;
      readonly fatura: BeforeAfter;
      readonly total_devido: BeforeAfter;
      readonly despesas_do_mes: BeforeAfter;
    };
    readonly breakdown: {
      readonly compras: { readonly count: number; readonly amount: string };
      readonly parcelas: readonly {
        readonly description: string;
        readonly no: number;
        readonly total: number;
        readonly amount: string;
      }[];
      readonly creditos: string;
      readonly encargos: string;
      readonly total: string;
    };
  } | null;
  readonly as_of: string;
};

export type BeforeAfter = { readonly before: string; readonly after: string };

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
