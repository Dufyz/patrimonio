import { request } from './client.js';

/**
 * CTA-02 · `GET /api/finance/accounts/:id/statement`: as linhas da conta com o
 * saldo após cada uma, e os totais do período.
 */
export type StatementLineResource = {
  readonly id: string;
  readonly date: string;
  readonly origin: string;
  readonly description: string;
  readonly note: string | null;
  readonly category_id: string | null;
  /** Com sinal: positivo entra, negativo sai. */
  readonly amount: string;
  readonly tags: readonly string[];
  readonly entry_id: string | null;
  readonly balance_after: string;
};

export type AccountStatementResource = {
  readonly account: {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly institution: string | null;
  };
  readonly range: { readonly from: string; readonly to: string };
  readonly opening: string;
  readonly entered: string;
  readonly left: string;
  readonly closing: string;
  readonly lines: readonly StatementLineResource[];
  readonly through: string;
};

export const fetchAccountStatement = (
  accountId: string,
  query: { readonly month?: string; readonly from?: string; readonly to?: string } = {},
  signal?: AbortSignal,
): Promise<AccountStatementResource> => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value);
  }
  const search = params.toString();
  return request(
    `/api/finance/accounts/${encodeURIComponent(accountId)}/statement${search === '' ? '' : `?${search}`}`,
    { parse: (value: unknown) => value as AccountStatementResource },
    signal === undefined ? {} : { signal },
  );
};
