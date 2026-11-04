import type {
  PortfolioDailyWrite,
  PositionDailyWrite,
  ProjectionRepository,
  RealizedResultWrite,
  TaxMonthWrite,
} from '@patrimonio/application';
import {
  parsePortfolioDailyFromDB,
  parsePositionDailyFromDB,
  parseRealizedResultFromDB,
  parseTaxMonthFromDB,
} from '@patrimonio/domain';
import type { DateOnly, Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * As tabelas de projeção. Toda escrita é em lote, por `jsonb_array_elements`: o
 * fechamento de uma carteira com trezentos ativos é uma consulta, e a
 * reconstrução de dez anos são 2.500 consultas em vez de 750 mil.
 *
 * O `text` antes do `jsonb` não é enfeite: com o cast direto o driver infere o
 * parâmetro como json e reencoda a string, que chega escalar do outro lado.
 */
const asJson = (rows: readonly unknown[]): string => JSON.stringify(rows);

export const createProjectionRepository = (sql: Connection): ProjectionRepository => ({
  /**
   * Apagar antes de regravar. A partição por ano de `position_daily` faz este
   * `DELETE` tocar só as partições do intervalo, e não a tabela inteira.
   */
  deleteFrom: async (portfolioId: string, fromDate: DateOnly) => {
    try {
      const positions = await sql<{ portfolio_id: string }[]>`
        DELETE FROM position_daily
         WHERE portfolio_id = ${portfolioId}
           AND position_date >= ${fromDate}
        RETURNING portfolio_id
      `;

      const days = await sql<{ portfolio_id: string }[]>`
        DELETE FROM portfolio_daily
         WHERE portfolio_id = ${portfolioId}
           AND position_date >= ${fromDate}
        RETURNING portfolio_id
      `;

      return success({ positions: positions.length, days: days.length });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  upsertPositions: async (rows: readonly PositionDailyWrite[]) => {
    if (rows.length === 0) return success(0);

    try {
      const written = await sql<{ asset_id: string }[]>`
        INSERT INTO position_daily
          (portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
           market_value, price_source_kind, accrued_interest)
        SELECT (entry ->> 'portfolio_id')::UUID,
               (entry ->> 'asset_id')::UUID,
               (entry ->> 'position_date')::DATE,
               (entry ->> 'quantity')::NUMERIC,
               (entry ->> 'avg_price')::NUMERIC,
               (entry ->> 'cost_basis')::NUMERIC,
               (entry ->> 'market_value')::NUMERIC,
               (entry ->> 'price_source_kind')::computed_price_kind,
               (entry ->> 'accrued_interest')::NUMERIC
          FROM JSONB_ARRAY_ELEMENTS(${asJson(rows)}::TEXT::JSONB) AS entry
        ON CONFLICT (portfolio_id, asset_id, position_date) DO UPDATE SET
          quantity = EXCLUDED.quantity,
          avg_price = EXCLUDED.avg_price,
          cost_basis = EXCLUDED.cost_basis,
          market_value = EXCLUDED.market_value,
          price_source_kind = EXCLUDED.price_source_kind,
          accrued_interest = EXCLUDED.accrued_interest,
          computed_at = NOW()
        RETURNING asset_id
      `;

      return success(written.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  upsertPortfolioDays: async (rows: readonly PortfolioDailyWrite[]) => {
    if (rows.length === 0) return success(0);

    try {
      const written = await sql<{ position_date: string }[]>`
        INSERT INTO portfolio_daily
          (portfolio_id, position_date, total_value, net_flow, income, payouts,
           quota_value, quota_count, cumulative_contributions)
        SELECT (entry ->> 'portfolio_id')::UUID,
               (entry ->> 'position_date')::DATE,
               (entry ->> 'total_value')::NUMERIC,
               (entry ->> 'net_flow')::NUMERIC,
               (entry ->> 'income')::NUMERIC,
               (entry ->> 'payouts')::NUMERIC,
               (entry ->> 'quota_value')::NUMERIC,
               (entry ->> 'quota_count')::NUMERIC,
               (entry ->> 'cumulative_contributions')::NUMERIC
          FROM JSONB_ARRAY_ELEMENTS(${asJson(rows)}::TEXT::JSONB) AS entry
        ON CONFLICT (portfolio_id, position_date) DO UPDATE SET
          total_value = EXCLUDED.total_value,
          net_flow = EXCLUDED.net_flow,
          income = EXCLUDED.income,
          payouts = EXCLUDED.payouts,
          quota_value = EXCLUDED.quota_value,
          quota_count = EXCLUDED.quota_count,
          cumulative_contributions = EXCLUDED.cumulative_contributions,
          computed_at = NOW()
        RETURNING position_date
      `;

      return success(written.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  lastDayBefore: async (portfolioId: string, date: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM portfolio_daily
         WHERE portfolio_id = ${portfolioId}
           AND position_date < ${date}
         ORDER BY position_date DESC
         LIMIT 1
      `;

      const row = rows[0];

      return success(row === undefined ? null : parsePortfolioDailyFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listPositionsOn: async (portfolioId: string, date: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM position_daily
         WHERE portfolio_id = ${portfolioId}
           AND position_date = ${date}
         ORDER BY market_value DESC
      `;

      return success(rows.map((row) => parsePositionDailyFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * As duas linhas de que o retorno de uma janela precisa. A consulta pega a
   * última linha em ou antes de cada data pedida, o que é o que faz "o retorno de
   * 12 meses lê duas linhas, não duas mil".
   */
  quotaPointsAt: async (portfolioId: string, dates: readonly DateOnly[]) => {
    if (dates.length === 0) return success([]);

    try {
      const rows = await sql<Row[]>`
        SELECT DISTINCT ON (asked.wanted) day.*
          FROM UNNEST(${sql.array([...dates])}::DATE[]) AS asked(wanted)
          JOIN portfolio_daily AS day
            ON day.portfolio_id = ${portfolioId}
           AND day.position_date <= asked.wanted
         ORDER BY asked.wanted, day.position_date DESC
      `;

      return success(rows.map((row) => parsePortfolioDailyFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listDaysBetween: async (portfolioId: string, from: DateOnly, to: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM portfolio_daily
         WHERE portfolio_id = ${portfolioId}
           AND position_date BETWEEN ${from} AND ${to}
         ORDER BY position_date
      `;

      return success(rows.map((row) => parsePortfolioDailyFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  replaceRealized: async (
    portfolioId: string,
    fromDate: DateOnly,
    rows: readonly RealizedResultWrite[],
  ) => {
    try {
      await sql`
        DELETE FROM realized_result
         WHERE portfolio_id = ${portfolioId}
           AND trade_date >= ${fromDate}
      `;

      if (rows.length === 0) return success(0);

      const written = await sql<{ transaction_id: string }[]>`
        INSERT INTO realized_result
          (transaction_id, portfolio_id, asset_id, trade_date, proceeds,
           cost_consumed, result, exempt, loss_offset)
        SELECT (entry ->> 'transaction_id')::UUID,
               (entry ->> 'portfolio_id')::UUID,
               (entry ->> 'asset_id')::UUID,
               (entry ->> 'trade_date')::DATE,
               (entry ->> 'proceeds')::NUMERIC,
               (entry ->> 'cost_consumed')::NUMERIC,
               (entry ->> 'result')::NUMERIC,
               (entry ->> 'exempt')::BOOLEAN,
               (entry ->> 'loss_offset')::NUMERIC
          FROM JSONB_ARRAY_ELEMENTS(${asJson(rows)}::TEXT::JSONB) AS entry
        ON CONFLICT (transaction_id) DO UPDATE SET
          portfolio_id = EXCLUDED.portfolio_id,
          asset_id = EXCLUDED.asset_id,
          trade_date = EXCLUDED.trade_date,
          proceeds = EXCLUDED.proceeds,
          cost_consumed = EXCLUDED.cost_consumed,
          result = EXCLUDED.result,
          exempt = EXCLUDED.exempt,
          loss_offset = EXCLUDED.loss_offset,
          computed_at = NOW()
        RETURNING transaction_id
      `;

      return success(written.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listRealizedBetween: async (portfolioId: string, from: DateOnly, to: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM realized_result
         WHERE portfolio_id = ${portfolioId}
           AND trade_date BETWEEN ${from} AND ${to}
         ORDER BY trade_date, transaction_id
      `;

      return success(rows.map((row) => parseRealizedResultFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  upsertTaxMonths: async (rows: readonly TaxMonthWrite[]) => {
    if (rows.length === 0) return success(0);

    try {
      const written = await sql<{ year: number }[]>`
        INSERT INTO tax_month
          (year, month, asset_class, sales_total, gross_result, exempt,
           loss_carried_forward)
        SELECT (entry ->> 'year')::SMALLINT,
               (entry ->> 'month')::SMALLINT,
               (entry ->> 'asset_class')::asset_class,
               (entry ->> 'sales_total')::NUMERIC,
               (entry ->> 'gross_result')::NUMERIC,
               (entry ->> 'exempt')::BOOLEAN,
               (entry ->> 'loss_carried_forward')::NUMERIC
          FROM JSONB_ARRAY_ELEMENTS(${asJson(rows)}::TEXT::JSONB) AS entry
        ON CONFLICT (year, month, asset_class) DO UPDATE SET
          sales_total = EXCLUDED.sales_total,
          gross_result = EXCLUDED.gross_result,
          exempt = EXCLUDED.exempt,
          loss_carried_forward = EXCLUDED.loss_carried_forward,
          computed_at = NOW()
        RETURNING year
      `;

      return success(written.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listTaxMonths: async (year: number) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM tax_month
         WHERE year = ${year}
         ORDER BY month, asset_class
      `;

      return success(rows.map((row) => parseTaxMonthFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
