import type {
  ClassifiedLedgerRow,
  LedgerRepository,
  LedgerRow,
} from '@patrimonio/application';
import {
  asDateOnly,
  asNumeric,
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

  entriesForPortfolioInstitution: async (portfolioId: string, institutionId: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM transaction
         WHERE portfolio_id = ${portfolioId}
           AND institution_id = ${institutionId}
         ORDER BY trade_date, id
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
