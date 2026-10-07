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
        insert into manual_price (asset_id, price_date, price)
        values (${draft.asset_id}, ${draft.price_date}, ${draft.price})
        on conflict (asset_id, price_date)
        do update set price = excluded.price
        returning *
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
        select * from manual_price where asset_id = ${assetId} order by price_date desc
      `;

      return success(rows.map((row) => parseManualPriceFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  latestUntil: async (assetId: string, date: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        select *
          from manual_price
         where asset_id = ${assetId}
           and price_date <= ${date}
         order by price_date desc
         limit 1
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
        delete from manual_price
         where asset_id = ${assetId} and price_date = ${date}
        returning asset_id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
