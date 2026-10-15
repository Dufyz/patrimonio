import type {
  CustodyTransferDraft,
  CustodyTransferRepository,
} from '@patrimonio/application';
import { parseCustodyTransferFromDB, toDateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

type Row = Record<string, unknown>;

export const createCustodyTransferRepository = (
  sql: Connection,
): CustodyTransferRepository => ({
  create: async (draft: CustodyTransferDraft) => {
    try {
      const rows = await sql<Row[]>`
        INSERT INTO custody_transfer
          (id, portfolio_id, asset_id, from_institution_id, to_institution_id,
           transfer_date, note)
        VALUES (${uuidv7()}, ${draft.portfolio_id}, ${draft.asset_id},
                ${draft.from_institution_id}, ${draft.to_institution_id},
                ${draft.transfer_date}, ${draft.note})
        RETURNING *
      `;

      const created = rows[0];
      if (created === undefined) {
        return failure(
          getRepositoryError(new Error('insert de transferência sem retorno')),
        );
      }

      return success(parseCustodyTransferFromDB(created));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listByPortfolioAsset: async (portfolioId: string, assetId: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM custody_transfer
         WHERE portfolio_id = ${portfolioId} AND asset_id = ${assetId}
         ORDER BY transfer_date DESC, created_at DESC
      `;

      return success(rows.map((row) => parseCustodyTransferFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`SELECT * FROM custody_transfer WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseCustodyTransferFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  currentCustody: async (portfolioId: string, assetId: string) => {
    try {
      const rows = await sql<{ institution_id: string; as_of: string | Date }[]>`
        SELECT e.institution_id, e.event_date AS as_of
          FROM (
            SELECT t.institution_id, t.trade_date AS event_date, t.created_at
              FROM transaction t
             WHERE t.portfolio_id = ${portfolioId} AND t.asset_id = ${assetId}
            UNION ALL
            SELECT c.to_institution_id, c.transfer_date, c.created_at
              FROM custody_transfer c
             WHERE c.portfolio_id = ${portfolioId} AND c.asset_id = ${assetId}
          ) e
         ORDER BY e.event_date DESC, e.created_at DESC
         LIMIT 1
      `;
      const row = rows[0];
      if (row === undefined) return success(null);

      return success({
        institution_id: row.institution_id,
        as_of: toDateOnly(row.as_of),
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  remove: async (id: string) => {
    try {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM custody_transfer WHERE id = ${id} RETURNING id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
