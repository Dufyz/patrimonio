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
        delete from position_daily
         where portfolio_id = ${portfolioId}
           and position_date >= ${fromDate}
        returning portfolio_id
      `;

      const days = await sql<{ portfolio_id: string }[]>`
        delete from portfolio_daily
         where portfolio_id = ${portfolioId}
           and position_date >= ${fromDate}
        returning portfolio_id
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
        insert into position_daily
          (portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
           market_value, price_source_kind, accrued_interest)
        select (entry ->> 'portfolio_id')::uuid,
               (entry ->> 'asset_id')::uuid,
               (entry ->> 'position_date')::date,
               (entry ->> 'quantity')::numeric,
               (entry ->> 'avg_price')::numeric,
               (entry ->> 'cost_basis')::numeric,
               (entry ->> 'market_value')::numeric,
               (entry ->> 'price_source_kind')::computed_price_kind,
               (entry ->> 'accrued_interest')::numeric
          from jsonb_array_elements(${asJson(rows)}::text::jsonb) as entry
        on conflict (portfolio_id, asset_id, position_date) do update set
          quantity = excluded.quantity,
          avg_price = excluded.avg_price,
          cost_basis = excluded.cost_basis,
          market_value = excluded.market_value,
          price_source_kind = excluded.price_source_kind,
          accrued_interest = excluded.accrued_interest,
          computed_at = now()
        returning asset_id
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
        insert into portfolio_daily
          (portfolio_id, position_date, total_value, net_flow, income, payouts,
           quota_value, quota_count, cumulative_contributions)
        select (entry ->> 'portfolio_id')::uuid,
               (entry ->> 'position_date')::date,
               (entry ->> 'total_value')::numeric,
               (entry ->> 'net_flow')::numeric,
               (entry ->> 'income')::numeric,
               (entry ->> 'payouts')::numeric,
               (entry ->> 'quota_value')::numeric,
               (entry ->> 'quota_count')::numeric,
               (entry ->> 'cumulative_contributions')::numeric
          from jsonb_array_elements(${asJson(rows)}::text::jsonb) as entry
        on conflict (portfolio_id, position_date) do update set
          total_value = excluded.total_value,
          net_flow = excluded.net_flow,
          income = excluded.income,
          payouts = excluded.payouts,
          quota_value = excluded.quota_value,
          quota_count = excluded.quota_count,
          cumulative_contributions = excluded.cumulative_contributions,
          computed_at = now()
        returning position_date
      `;

      return success(written.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  lastDayBefore: async (portfolioId: string, date: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        select *
          from portfolio_daily
         where portfolio_id = ${portfolioId}
           and position_date < ${date}
         order by position_date desc
         limit 1
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
        select *
          from position_daily
         where portfolio_id = ${portfolioId}
           and position_date = ${date}
         order by market_value desc
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
        select distinct on (asked.wanted) day.*
          from unnest(${sql.array([...dates])}::date[]) as asked(wanted)
          join portfolio_daily as day
            on day.portfolio_id = ${portfolioId}
           and day.position_date <= asked.wanted
         order by asked.wanted, day.position_date desc
      `;

      return success(rows.map((row) => parsePortfolioDailyFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listDaysBetween: async (portfolioId: string, from: DateOnly, to: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        select *
          from portfolio_daily
         where portfolio_id = ${portfolioId}
           and position_date between ${from} and ${to}
         order by position_date
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
        delete from realized_result
         where portfolio_id = ${portfolioId}
           and trade_date >= ${fromDate}
      `;

      if (rows.length === 0) return success(0);

      const written = await sql<{ transaction_id: string }[]>`
        insert into realized_result
          (transaction_id, portfolio_id, asset_id, trade_date, proceeds,
           cost_consumed, result, exempt, loss_offset)
        select (entry ->> 'transaction_id')::uuid,
               (entry ->> 'portfolio_id')::uuid,
               (entry ->> 'asset_id')::uuid,
               (entry ->> 'trade_date')::date,
               (entry ->> 'proceeds')::numeric,
               (entry ->> 'cost_consumed')::numeric,
               (entry ->> 'result')::numeric,
               (entry ->> 'exempt')::boolean,
               (entry ->> 'loss_offset')::numeric
          from jsonb_array_elements(${asJson(rows)}::text::jsonb) as entry
        on conflict (transaction_id) do update set
          portfolio_id = excluded.portfolio_id,
          asset_id = excluded.asset_id,
          trade_date = excluded.trade_date,
          proceeds = excluded.proceeds,
          cost_consumed = excluded.cost_consumed,
          result = excluded.result,
          exempt = excluded.exempt,
          loss_offset = excluded.loss_offset,
          computed_at = now()
        returning transaction_id
      `;

      return success(written.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listRealizedBetween: async (portfolioId: string, from: DateOnly, to: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        select *
          from realized_result
         where portfolio_id = ${portfolioId}
           and trade_date between ${from} and ${to}
         order by trade_date, transaction_id
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
        insert into tax_month
          (year, month, asset_class, sales_total, gross_result, exempt,
           loss_carried_forward)
        select (entry ->> 'year')::smallint,
               (entry ->> 'month')::smallint,
               (entry ->> 'asset_class')::asset_class,
               (entry ->> 'sales_total')::numeric,
               (entry ->> 'gross_result')::numeric,
               (entry ->> 'exempt')::boolean,
               (entry ->> 'loss_carried_forward')::numeric
          from jsonb_array_elements(${asJson(rows)}::text::jsonb) as entry
        on conflict (year, month, asset_class) do update set
          sales_total = excluded.sales_total,
          gross_result = excluded.gross_result,
          exempt = excluded.exempt,
          loss_carried_forward = excluded.loss_carried_forward,
          computed_at = now()
        returning year
      `;

      return success(written.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listTaxMonths: async (year: number) => {
    try {
      const rows = await sql<Row[]>`
        select *
          from tax_month
         where year = ${year}
         order by month, asset_class
      `;

      return success(rows.map((row) => parseTaxMonthFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
