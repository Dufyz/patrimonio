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
      const rows = await sql<Row[]>`select * from asset where id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseAssetFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  findByTicker: async (ticker: string) => {
    try {
      const rows = await sql<Row[]>`
        select * from asset where upper(ticker) = upper(${ticker}) limit 1
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
        select *
          from asset
         where ${filter.includeArchived === true ? sql`true` : sql`archived_at is null`}
           and ${filter.origin === undefined ? sql`true` : sql`origin = ${filter.origin}`}
           and ${
             search === null
               ? sql`true`
               : sql`(ticker ilike ${search} or name ilike ${search})`
           }
         order by ticker
         limit 100
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
        select asset.*
          from asset
         where exists (
                 select 1 from transaction
                  where transaction.asset_id = asset.id
                    and transaction.portfolio_id = ${portfolioId}
               )
         order by asset.ticker
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
      const rows = await sql<Row[]>`insert into asset ${sql(row)} returning *`;
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
        ? await sql<Row[]>`update asset set ${sql(changes)} where id = ${id} returning *`
        : await sql<Row[]>`select * from asset where id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseAssetFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  setArchived: async (id: string, archived: boolean) => {
    try {
      const rows = await sql<Row[]>`
        update asset
           set archived_at = ${archived ? sql`now()` : sql`null`}
         where id = ${id}
        returning *
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
        delete from asset where id = ${id} returning id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  usage: async (id: string) => {
    try {
      const rows = await sql<{ transactions: string; portfolios: string }[]>`
        select count(*)::text as transactions,
               count(distinct portfolio_id)::text as portfolios
          from transaction
         where asset_id = ${id}
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
