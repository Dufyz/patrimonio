import { request } from './client.js';

/**
 * CTA-01 · `GET /api/finance/accounts`: o saldo de hoje e o previsto de fim de
 * mês de cada conta, e o total das contas com "no patrimônio".
 */
export type AccountRowResource = {
  readonly account: {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly institution: string | null;
    readonly role: string;
    readonly in_wealth: boolean;
    readonly archived: boolean;
  };
  readonly balance: string;
  readonly variation: string;
  readonly cards: readonly string[];
  readonly projected_month_end: string;
};

export type AccountsResource = {
  readonly accounts: readonly AccountRowResource[];
  readonly total_balance: string;
  readonly projected_total: string;
  readonly as_of: string;
};

export const fetchAccounts = (
  includeArchived: boolean,
  signal?: AbortSignal,
): Promise<AccountsResource> =>
  request(
    `/api/finance/accounts${includeArchived ? '?include_archived=true' : ''}`,
    { parse: (value: unknown) => value as AccountsResource },
    signal === undefined ? {} : { signal },
  );
