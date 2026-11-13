import type {
  ClassifiedLedgerRow,
  LedgerRepository,
  LedgerRow,
} from '@patrimonio/application';
import {
  asDateOnly,
  asDateOnlyOrNull,
  asNumeric,
  asNumericOrNull,
  asString,
  asStringOrNull,
  toDateOnly,
} from '@patrimonio/domain';
import type { Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * O livro no formato que o motor consome. A cópia é campo a campo, como todo
 * parser: coluna nova no `SELECT` não vira entrada do cálculo sem alguém
 * escrever a linha aqui.
 */
const parseLedgerRowFromDB = (row: Row): LedgerRow => ({
  id: asString(row, 'id'),
  kind: asString(row, 'kind') as LedgerRow['kind'],
  trade_date: asDateOnly(row, 'trade_date'),
  settlement_date: asDateOnly(row, 'settlement_date'),
  maturity_date: asDateOnlyOrNull(row, 'maturity_date'),
  quantity: asNumeric(row, 'quantity'),
  unit_price: asNumeric(row, 'unit_price'),
  fees: asNumeric(row, 'fees'),
  net_amount: asNumeric(row, 'net_amount'),
  payout_kind: asStringOrNull(row, 'payout_kind'),
  event_ratio_from: asStringOrNull(row, 'event_ratio_from'),
  event_ratio_to: asStringOrNull(row, 'event_ratio_to'),
  portfolio_id: asString(row, 'portfolio_id'),
  asset_id: asStringOrNull(row, 'asset_id'),
  institution_id: asString(row, 'institution_id'),
});

/**
 * A mesma cópia campo a campo, mais o tipo do papel: a apuração classifica a venda
 * sem precisar listar o cadastro de ativos inteiro.
 */
const parseClassifiedRowFromDB = (row: Row): ClassifiedLedgerRow => ({
  ...parseLedgerRowFromDB(row),
  b3_type: asStringOrNull(row, 'b3_type') as ClassifiedLedgerRow['b3_type'],
});

export const createLedgerRepository = (sql: Connection): LedgerRepository => ({
  entriesForPortfolioAsset: async (portfolioId: string, assetId: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM transaction
         WHERE portfolio_id = ${portfolioId}
           AND asset_id = ${assetId}
         ORDER BY trade_date, id
      `;

      return success(rows.map((row) => parseLedgerRowFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  bookRows: async (range) => {
    try {
      const rows = await sql<Row[]>`
        SELECT t.id, t.kind, t.trade_date, t.portfolio_id, p.name AS portfolio_name,
               t.asset_id, a.ticker AS asset_name, a.category_id AS asset_class,
               t.quantity, t.unit_price, t.fees, t.net_amount, t.payout_kind,
               t.event_ratio_from, t.event_ratio_to, t.event_id,
               -- PM da posição antes e depois do dia. Com mais de um lançamento do
               -- ativo no dia, antes e depois não se separam por linha: fica nulo.
               CASE WHEN COUNT(*) OVER (
                           PARTITION BY t.portfolio_id, t.asset_id, t.trade_date
                         ) = 1
                    THEN (SELECT pd.avg_price
                            FROM position_daily pd
                           WHERE pd.portfolio_id = t.portfolio_id
                             AND pd.asset_id = t.asset_id
                             AND pd.position_date < t.trade_date
                           ORDER BY pd.position_date DESC
                           LIMIT 1)
               END AS avg_price_before,
               CASE WHEN COUNT(*) OVER (
                           PARTITION BY t.portfolio_id, t.asset_id, t.trade_date
                         ) = 1
                    THEN (SELECT pd.avg_price
                            FROM position_daily pd
                           WHERE pd.portfolio_id = t.portfolio_id
                             AND pd.asset_id = t.asset_id
                             AND pd.position_date <= t.trade_date
                           ORDER BY pd.position_date DESC
                           LIMIT 1)
               END AS avg_price_after
          FROM transaction t
          JOIN portfolio p ON p.id = t.portfolio_id
          JOIN asset a ON a.id = t.asset_id
         WHERE t.trade_date BETWEEN ${range.from} AND ${range.to}
         ORDER BY t.trade_date DESC, t.id DESC
      `;

      return success(
        rows.map((row) => ({
          id: asString(row, 'id'),
          kind: asString(row, 'kind') as 'buy' | 'sell' | 'payout' | 'corporate_event',
          date: asDateOnly(row, 'trade_date'),
          portfolio_id: asString(row, 'portfolio_id'),
          portfolio_name: asString(row, 'portfolio_name'),
          asset_id: asString(row, 'asset_id'),
          asset_name: asString(row, 'asset_name'),
          asset_class: asStringOrNull(row, 'asset_class'),
          quantity: asNumeric(row, 'quantity'),
          unit_price: asNumeric(row, 'unit_price'),
          fees: asNumeric(row, 'fees'),
          net_amount: asNumeric(row, 'net_amount'),
          payout_kind: asStringOrNull(row, 'payout_kind'),
          event_ratio_from: asStringOrNull(row, 'event_ratio_from'),
          event_ratio_to: asStringOrNull(row, 'event_ratio_to'),
          event_id: asStringOrNull(row, 'event_id'),
          avg_price_before: asNumericOrNull(row, 'avg_price_before'),
          avg_price_after: asNumericOrNull(row, 'avg_price_after'),
        })),
      );
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  entriesForAsset: async (assetId: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM transaction
         WHERE asset_id = ${assetId}
         ORDER BY portfolio_id, trade_date, id
      `;

      return success(rows.map((row) => parseLedgerRowFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * O livro de todas as carteiras. A apuração de renda variável é global: o limite
   * de isenção olha a soma das vendas do mês, não da carteira.
   */
  allEntries: async (untilDate) => {
    try {
      const rows = await sql<Row[]>`
        SELECT transaction.*, asset.b3_type
          FROM transaction
          LEFT JOIN asset ON asset.id = transaction.asset_id
         WHERE transaction.trade_date <= ${untilDate}
         ORDER BY transaction.portfolio_id, transaction.asset_id,
                  transaction.trade_date, transaction.id
      `;

      return success(rows.map((row) => parseClassifiedRowFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  entriesForPortfolio: async (portfolioId: string, untilDate: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM transaction
         WHERE portfolio_id = ${portfolioId}
           AND trade_date <= ${untilDate}
         ORDER BY trade_date, id
      `;

      return success(rows.map((row) => parseLedgerRowFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  assetCategories: async (portfolioId: string) => {
    try {
      const rows = await sql<{ asset_id: string; category_id: string | null }[]>`
        SELECT DISTINCT a.id AS asset_id, a.category_id
          FROM transaction t
          JOIN asset a ON a.id = t.asset_id
         WHERE t.portfolio_id = ${portfolioId}
      `;

      return success(new Map(rows.map((row) => [row.asset_id, row.category_id])));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  firstTradeDate: async () => {
    try {
      const rows = await sql<{ first: string | Date | null }[]>`
        SELECT MIN(trade_date) AS first FROM transaction
      `;

      const first = rows[0]?.first ?? null;

      return success(first === null ? null : toDateOnly(first));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /** Uma consulta: carteira e a data do lançamento mais antigo daquele ativo. */
  portfoliosHoldingAsset: async (assetId: string) => {
    try {
      const rows = await sql<{ portfolio_id: string; from_date: string | Date }[]>`
        SELECT portfolio_id, MIN(trade_date) AS from_date
          FROM transaction
         WHERE asset_id = ${assetId}
         GROUP BY portfolio_id
      `;

      return success(
        rows.map((row) => ({
          portfolio_id: row.portfolio_id,
          from_date: toDateOnly(row.from_date),
        })),
      );
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
