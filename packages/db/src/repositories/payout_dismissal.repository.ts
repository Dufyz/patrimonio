import type {
  PayoutDismissalDraft,
  PayoutDismissalRepository,
} from '@patrimonio/application';
import { parsePayoutDismissalFromDB } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

type Row = Record<string, unknown>;

export const createPayoutDismissalRepository = (
  sql: Connection,
): PayoutDismissalRepository => ({
  create: async (draft: PayoutDismissalDraft) => {
    try {
      const rows = await sql<Row[]>`
        INSERT INTO payout_dismissal
          (id, portfolio_id, asset_id, payout_kind, record_date, payment_date,
           expected_net_amount, reason)
        VALUES (${uuidv7()}, ${draft.portfolio_id}, ${draft.asset_id},
                ${draft.payout_kind}, ${draft.record_date}, ${draft.payment_date},
                ${draft.expected_net_amount}, ${draft.reason})
        RETURNING *
      `;

      const created = rows[0];
      if (created === undefined) {
        return failure(getRepositoryError(new Error('insert de descarte sem retorno')));
      }

      return success(parsePayoutDismissalFromDB(created));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listByPortfolio: async (portfolioId: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT * FROM payout_dismissal
         WHERE portfolio_id = ${portfolioId}
         ORDER BY payment_date DESC
      `;

      return success(rows.map((row) => parsePayoutDismissalFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
