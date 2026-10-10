import type {
  PortfolioDraft,
  PortfolioRepository,
  PortfolioWrite,
  StrategyTargetWrite,
} from '@patrimonio/application';
import { parsePortfolioFromDB, parseStrategyTargetFromDB } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';
import { definedColumns, hasChanges } from '../support/changes.js';

type Row = Record<string, unknown>;

export const createPortfolioRepository = (sql: Connection): PortfolioRepository => ({
  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`SELECT * FROM portfolio WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parsePortfolioFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /** Sem distinguir maiúscula, como o índice de unicidade. */
  findByName: async (name: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM portfolio
         WHERE LOWER(name) = LOWER(${name})
         -- A ativa primeiro: arquivar libera o nome, e pode haver homônima no
         -- histórico.
         ORDER BY archived_at NULLS FIRST
         LIMIT 1
      `;
      const row = rows[0];

      return success(row === undefined ? null : parsePortfolioFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  list: async (options) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM portfolio
         WHERE ${options.includeArchived ? sql`TRUE` : sql`archived_at IS NULL`}
         ORDER BY sort_order, LOWER(name)
      `;

      return success(rows.map((row) => parsePortfolioFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  create: async (draft: PortfolioDraft) => {
    const row = definedColumns({
      id: uuidv7(),
      name: draft.name,
      purpose: draft.purpose,
      benchmark_id: draft.benchmark_id,
      tolerance_pp: draft.tolerance_pp,
      max_asset_weight_pct: draft.max_asset_weight_pct,
      rebalance_mode: draft.rebalance_mode,
      review_every_months: draft.review_every_months,
      sort_order: draft.sort_order,
    });

    try {
      const rows = await sql<Row[]>`
        INSERT INTO portfolio ${sql(row)} RETURNING *
      `;
      const created = rows[0];

      if (created === undefined) {
        return failure(getRepositoryError(new Error('insert de carteira sem retorno')));
      }

      return success(parsePortfolioFromDB(created));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  update: async (id: string, patch: PortfolioWrite) => {
    const changes = definedColumns({ ...patch });

    try {
      const rows = hasChanges(changes)
        ? await sql<Row[]>`
            UPDATE portfolio SET ${sql(changes)} WHERE id = ${id} RETURNING *
          `
        : await sql<Row[]>`SELECT * FROM portfolio WHERE id = ${id}`;

      const row = rows[0];

      return success(row === undefined ? null : parsePortfolioFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  setArchived: async (id: string, archived: boolean) => {
    try {
      const rows = await sql<Row[]>`
        UPDATE portfolio
           SET archived_at = ${archived ? sql`NOW()` : sql`NULL`}
         WHERE id = ${id}
        RETURNING *
      `;
      const row = rows[0];

      return success(row === undefined ? null : parsePortfolioFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  remove: async (id: string) => {
    try {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM portfolio WHERE id = ${id} RETURNING id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /** Uma consulta para as duas contagens: é o que a tela de exclusão mostra. */
  contentSummary: async (id: string) => {
    try {
      const rows = await sql<{ transactions: string; assets: string }[]>`
        SELECT COUNT(*)::TEXT AS transactions,
               COUNT(DISTINCT asset_id)::TEXT AS assets
          FROM transaction
         WHERE portfolio_id = ${id}
      `;
      const row = rows[0];

      return success({
        transactions: Number(row?.transactions ?? 0),
        assets: Number(row?.assets ?? 0),
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  moveContent: async (from: string, to: string) => {
    try {
      const rows = await sql<{ moved: string; from_date: string | null }[]>`
        WITH moved AS (
          UPDATE transaction
             SET portfolio_id = ${to}
           WHERE portfolio_id = ${from}
          RETURNING trade_date
        )
        SELECT COUNT(*)::TEXT AS moved, MIN(trade_date) AS from_date FROM moved
      `;
      const row = rows[0];

      return success({
        moved: Number(row?.moved ?? 0),
        from_date: row?.from_date ?? null,
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  deleteTransactions: async (id: string) => {
    try {
      const rows = await sql<{ total: string }[]>`
        WITH removed AS (
          DELETE FROM transaction WHERE portfolio_id = ${id} RETURNING id
        )
        SELECT COUNT(*)::TEXT AS total FROM removed
      `;

      return success(Number(rows[0]?.total ?? 0));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * O único caminho até as quatro colunas de recálculo. Nenhuma rota chega aqui:
   * `PortfolioWrite` não as declara, e quem chama este método é o `apply`.
   */
  applyRecalcTransition: async (id: string, write) => {
    try {
      await sql`
        UPDATE portfolio
           SET recalc_status = ${write.recalc_status},
               recalc_from_date = ${write.from_date},
               recalc_error = ${write.error},
               recalc_updated_at = NOW()
         WHERE id = ${id}
      `;

      return success(undefined);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /** As carteiras que o fechamento diário percorre. Arquivada não fecha. */
  listActiveIds: async () => {
    try {
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM portfolio WHERE archived_at IS NULL ORDER BY sort_order, id
      `;

      return success(rows.map((row) => row.id));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listTargets: async (portfolioId: string) => {
    try {
      const rows = await sql<Row[]>`
        SELECT * FROM strategy_target WHERE portfolio_id = ${portfolioId}
      `;

      return success(rows.map((row) => parseStrategyTargetFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * Apagar e regravar na mesma transação é seguro porque o trigger que exige
   * soma 100 é diferido: ele roda no commit, com o alvo inteiro no lugar.
   */
  replaceTargets: async (
    portfolioId: string,
    targets: readonly StrategyTargetWrite[],
  ) => {
    try {
      await sql`DELETE FROM strategy_target WHERE portfolio_id = ${portfolioId}`;

      if (targets.length === 0) return success([]);

      const payload = JSON.stringify(
        targets.map((target) => ({
          category_id: target.category_id,
          target_pct: target.target_pct,
        })),
      );

      // Uma consulta para N linhas: a lista entra como jsonb e volta expandida.
      const rows = await sql<Row[]>`
        INSERT INTO strategy_target (portfolio_id, category_id, target_pct)
        SELECT ${portfolioId}::UUID,
               (entry ->> 'category_id')::UUID,
               (entry ->> 'target_pct')::NUMERIC
          FROM JSONB_ARRAY_ELEMENTS(${payload}::TEXT::JSONB) AS entry
        RETURNING *
      `;

      return success(rows.map((row) => parseStrategyTargetFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
