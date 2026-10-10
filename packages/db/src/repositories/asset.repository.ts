import type {
  AssetDraft,
  AssetFilter,
  AssetRepository,
  AssetWrite,
} from '@patrimonio/application';
import { parseAssetFromDB } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';
import { definedColumns, hasChanges } from '../support/changes.js';

type Row = Record<string, unknown>;

export const createAssetRepository = (sql: Connection): AssetRepository => ({
  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`SELECT * FROM asset WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseAssetFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  findByTicker: async (ticker: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT * FROM asset WHERE UPPER(ticker) = UPPER(${ticker}) LIMIT 1
      `;
      const row = rows[0];

      return success(row === undefined ? null : parseAssetFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * A busca do seletor de lançamento: código ou nome, sem distinguir maiúscula.
   * Enquanto a base da B3 não é carregada (M-07), ela encontra o que já existe
   * no cadastro local — e é isso que a tela diz.
   */
  list: async (filter: AssetFilter) => {
    const search = filter.search === undefined ? null : `%${filter.search}%`;

    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM asset
         WHERE ${filter.includeArchived === true ? sql`TRUE` : sql`archived_at IS NULL`}
           AND ${filter.origin === undefined ? sql`TRUE` : sql`origin = ${filter.origin}`}
           AND ${
             search === null
               ? sql`TRUE`
               : sql`(ticker ILIKE ${search} OR name ILIKE ${search})`
           }
         ORDER BY ticker
         LIMIT 100
      `;

      return success(rows.map((row) => parseAssetFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * Os ativos que aparecem no livro de uma carteira. Sem limite de página de
   * propósito: o fechamento precisa de todos, e paginar aqui deixaria uma posição
   * de fora do patrimônio.
   */
  listForPortfolio: async (portfolioId: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT asset.*
          FROM asset
         WHERE EXISTS (
                 SELECT 1 FROM transaction
                  WHERE transaction.asset_id = asset.id
                    AND transaction.portfolio_id = ${portfolioId}
               )
         ORDER BY asset.ticker
      `;

      return success(rows.map((row) => parseAssetFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  create: async (draft: AssetDraft) => {
    const row = definedColumns({
      id: uuidv7(),
      ticker: draft.ticker,
      name: draft.name,
      origin: draft.origin,
      b3_type: draft.b3_type,
      category_id: draft.category_id,
      sector: draft.sector,
      price_source: draft.price_source,
      issuer_id: draft.issuer_id,
      indexer: draft.indexer,
      rate: draft.rate,
      issued_at: draft.issued_at,
      maturity_date: draft.maturity_date,
      liquidity: draft.liquidity,
      liquidity_days: draft.liquidity_days,
      tax_regime: draft.tax_regime,
    });

    try {
      const rows = await sql<Row[]>`INSERT INTO asset ${sql(row)} RETURNING *`;
      const created = rows[0];

      if (created === undefined) {
        return failure(getRepositoryError(new Error('insert de ativo sem retorno')));
      }

      return success(parseAssetFromDB(created));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  update: async (id: string, patch: AssetWrite) => {
    const changes = definedColumns({ ...patch });

    try {
      const rows = hasChanges(changes)
        ? await sql<Row[]>`UPDATE asset SET ${sql(changes)} WHERE id = ${id} RETURNING *`
        : await sql<Row[]>`SELECT * FROM asset WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseAssetFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  setArchived: async (id: string, archived: boolean) => {
    try {
      const rows = await sql<Row[]>`
        UPDATE asset
           SET archived_at = ${archived ? sql`NOW()` : sql`NULL`}
         WHERE id = ${id}
        RETURNING *
      `;
      const row = rows[0];

      return success(row === undefined ? null : parseAssetFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  remove: async (id: string) => {
    try {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM asset WHERE id = ${id} RETURNING id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  usage: async (id: string) => {
    try {
      const rows = await sql<{ transactions: string; portfolios: string }[]>`
        SELECT COUNT(*)::TEXT AS transactions,
               COUNT(DISTINCT portfolio_id)::TEXT AS portfolios
          FROM transaction
         WHERE asset_id = ${id}
      `;
      const row = rows[0];

      return success({
        transactions: Number(row?.transactions ?? 0),
        portfolios: Number(row?.portfolios ?? 0),
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
