import type {
  CorporateEventDraft,
  CorporateEventRepository,
} from '@patrimonio/application';
import { parseCorporateEventFromDB } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

type Row = Record<string, unknown>;

export const createCorporateEventRepository = (
  sql: Connection,
): CorporateEventRepository => ({
  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`select * from corporate_event where id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseCorporateEventFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  list: async (filter) => {
    try {
      const rows = await sql<Row[]>`
        select *
          from corporate_event
         where ${filter.pending === true ? sql`confirmed_at is null` : sql`true`}
           and ${
             filter.asset_id === undefined
               ? sql`true`
               : sql`asset_id = ${filter.asset_id}`
           }
         order by record_date desc
      `;

      return success(rows.map((row) => parseCorporateEventFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /** Reanunciar o mesmo evento não cria linha nova nem reabre o confirmado. */
  upsert: async (draft: CorporateEventDraft) => {
    try {
      const rows = await sql<Row[]>`
        insert into corporate_event (id, asset_id, kind, record_date, ratio_from, ratio_to)
        values (${uuidv7()}, ${draft.asset_id}, ${draft.kind}, ${draft.record_date},
                ${draft.ratio_from}, ${draft.ratio_to})
        on conflict (asset_id, kind, record_date)
        do update set ratio_from = excluded.ratio_from, ratio_to = excluded.ratio_to
        returning *
      `;

      const row = rows[0];
      if (row === undefined) {
        return failure(getRepositoryError(new Error('upsert de evento sem retorno')));
      }

      return success(parseCorporateEventFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  confirm: async (id: string, confirmedAt: string) => {
    try {
      const rows = await sql<Row[]>`
        update corporate_event
           set confirmed_at = ${confirmedAt}
         where id = ${id}
           and confirmed_at is null
        returning *
      `;

      const row = rows[0];

      return success(row === undefined ? null : parseCorporateEventFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
