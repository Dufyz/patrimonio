import type {
  InstrumentCatalogRepository,
  InstrumentCatalogSummary,
} from '@patrimonio/application';
import { INSTRUMENT_TYPES, parseListedInstrumentFromDB } from '@patrimonio/domain';
import type { InstrumentType } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';
import { ARRAY_OID } from '../support/array_oid.js';
import { likeContains, likePrefix } from '../support/like.js';

type Row = Record<string, unknown>;

/**
 * O catálogo de papéis do mercado.
 *
 * A busca ordena pelo mesmo critério da busca global — ticker exato, prefixo do
 * ticker, prefixo do nome, contém — e compara sem acento. Não consulta carteira:
 * quem quiser saber o que a pessoa tem soma isso por cima do resultado.
 */
export const createInstrumentCatalogRepository = (
  sql: Connection,
): InstrumentCatalogRepository => ({
  search: async (filter) => {
    try {
      const text = filter.text?.trim() ?? '';
      const contains = likeContains(text);
      const prefix = likePrefix(text);
      const types = filter.types === undefined ? null : [...filter.types];

      const rows = await sql<Row[]>`
        SELECT i.*,
               COUNT(*) OVER () AS total
          FROM listed_instrument i
         WHERE (${filter.includeInactive === true} OR i.active)
           AND (${types}::TEXT[] IS NULL OR i.b3_type = ANY(${types}::TEXT[]))
           AND (${text === ''}
                OR unaccent(i.ticker) ILIKE unaccent(${contains}::TEXT)
                OR unaccent(i.name) ILIKE unaccent(${contains}::TEXT))
         ORDER BY CASE
                    WHEN ${text === ''} THEN 0
                    WHEN unaccent(LOWER(i.ticker)) = unaccent(LOWER(${text}::TEXT)) THEN 0
                    WHEN unaccent(i.ticker) ILIKE unaccent(${prefix}::TEXT) THEN 1
                    WHEN unaccent(i.name) ILIKE unaccent(${prefix}::TEXT) THEN 2
                    ELSE 3
                  END,
                  i.active DESC,
                  i.ticker
         LIMIT ${filter.limit}
      `;

      return success({
        items: rows.map((row) => parseListedInstrumentFromDB(row)),
        total: rows[0] === undefined ? 0 : Number(rows[0]['total']),
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  findByTicker: async (ticker) => {
    try {
      const rows = await sql<Row[]>`
        SELECT * FROM listed_instrument WHERE ticker = UPPER(${ticker}::TEXT)
      `;
      const row = rows[0];

      return success(row === undefined ? null : parseListedInstrumentFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  upsertMany: async (rows) => {
    if (rows.length === 0) return success({ created: 0, updated: 0 });

    try {
      const written = await sql<{ inserted: boolean }[]>`
        INSERT INTO listed_instrument
          (id, ticker, name, b3_type, maturity_date, source, active, last_trade_date)
        SELECT *
          FROM UNNEST(
            ${sql.array(
              rows.map(() => uuidv7()),
              ARRAY_OID.uuid,
            )}::UUID[],
            ${sql.array(
              rows.map((row) => row.ticker.toUpperCase()),
              ARRAY_OID.text,
            )}::TEXT[],
            ${sql.array(
              rows.map((row) => row.name),
              ARRAY_OID.text,
            )}::TEXT[],
            ${sql.array(
              rows.map((row) => row.b3_type),
              ARRAY_OID.text,
            )}::TEXT[],
            ${sql.array(
              rows.map((row) => row.maturity_date),
              ARRAY_OID.date,
            )}::DATE[],
            ${sql.array(
              rows.map((row) => row.source),
              ARRAY_OID.text,
            )}::TEXT[],
            ${sql.array(
              rows.map((row) => row.active),
              ARRAY_OID.boolean,
            )}::BOOLEAN[],
            ${sql.array(
              rows.map((row) => row.last_trade_date),
              ARRAY_OID.date,
            )}::DATE[]
          )
        ON CONFLICT (ticker) DO UPDATE
           SET name            = EXCLUDED.name,
               b3_type         = EXCLUDED.b3_type,
               maturity_date   = EXCLUDED.maturity_date,
               source          = EXCLUDED.source,
               active          = EXCLUDED.active,
               last_trade_date = COALESCE(EXCLUDED.last_trade_date, listed_instrument.last_trade_date)
        RETURNING (xmax = 0) AS inserted
      `;

      const created = written.filter((row) => row.inserted).length;

      return success({ created, updated: written.length - created });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  deactivateMissing: async (source, keep) => {
    try {
      const rows = await sql<{ id: string }[]>`
        UPDATE listed_instrument
           SET active = FALSE
         WHERE source = ${source}
           AND active
           AND NOT (ticker = ANY(${sql.array([...keep], ARRAY_OID.text)}::TEXT[]))
        RETURNING id
      `;

      return success(rows.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  summary: async () => {
    try {
      const rows = await sql<
        { b3_type: string; total: string; active: string; loaded: Date | null }[]
      >`
        SELECT b3_type,
               COUNT(*)::TEXT AS total,
               COUNT(*) FILTER (WHERE active)::TEXT AS active,
               MAX(updated_at) AS loaded
          FROM listed_instrument
         GROUP BY b3_type
      `;

      const byType = Object.fromEntries(
        INSTRUMENT_TYPES.map((type) => [type, 0]),
      ) as Record<InstrumentType, number>;
      let total = 0;
      let active = 0;
      let loaded: Date | null = null;

      for (const row of rows) {
        if ((INSTRUMENT_TYPES as readonly string[]).includes(row.b3_type)) {
          byType[row.b3_type as InstrumentType] = Number(row.total);
        }
        total += Number(row.total);
        active += Number(row.active);
        if (row.loaded !== null && (loaded === null || row.loaded > loaded)) {
          loaded = row.loaded;
        }
      }

      const summary: InstrumentCatalogSummary = {
        total,
        active,
        by_type: byType,
        last_loaded_at: loaded === null ? null : loaded.toISOString(),
      };

      return success(summary);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
