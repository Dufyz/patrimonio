import type { ManualPriceDraft, ManualPriceRepository } from '@patrimonio/application';
import { parseManualPriceFromDB } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

type Row = Record<string, unknown>;

export const createManualPriceRepository = (sql: Connection): ManualPriceRepository => ({
  upsert: async (draft: ManualPriceDraft) => {
    try {
      const rows = await sql<Row[]>`
        INSERT INTO manual_price (asset_id, price_date, price)
        VALUES (${draft.asset_id}, ${draft.price_date}, ${draft.price})
        ON CONFLICT (asset_id, price_date)
        DO UPDATE SET price = EXCLUDED.price
        RETURNING *
      `;

      const row = rows[0];
      if (row === undefined) {
        return failure(getRepositoryError(new Error('upsert de preço sem retorno')));
      }

      return success(parseManualPriceFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listByAsset: async (assetId: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT * FROM manual_price WHERE asset_id = ${assetId} ORDER BY price_date DESC
      `;

      return success(rows.map((row) => parseManualPriceFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  latestUntil: async (assetId: string, date: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM manual_price
         WHERE asset_id = ${assetId}
           AND price_date <= ${date}
         ORDER BY price_date DESC
         LIMIT 1
      `;
      const row = rows[0];

      return success(row === undefined ? null : parseManualPriceFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  remove: async (assetId: string, date: DateOnly) => {
    try {
      const rows = await sql<{ asset_id: string }[]>`
        DELETE FROM manual_price
         WHERE asset_id = ${assetId} AND price_date = ${date}
        RETURNING asset_id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
