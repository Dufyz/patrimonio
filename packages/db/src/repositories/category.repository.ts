import type {
  CategoryDraft,
  CategoryRepository,
  CategoryWrite,
} from '@patrimonio/application';
import { parseCategoryFromDB } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';
import { definedColumns, hasChanges } from '../support/changes.js';

type Row = Record<string, unknown>;

export const createCategoryRepository = (sql: Connection): CategoryRepository => ({
  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`SELECT * FROM category WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseCategoryFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /** Grupos primeiro, cada um seguido das suas categorias: é a ordem da tela. */
  list: async () => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM category
         ORDER BY COALESCE(parent_id, id), parent_id NULLS FIRST, sort_order, LOWER(name)
      `;

      return success(rows.map((row) => parseCategoryFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
  create: async (draft: CategoryDraft) => {
    try {
      // Depois da última: a ordem de exibição de uma classe nova é a do cadastro.
      const [last] = await sql<{ next: number }[]>`
        SELECT COALESCE(MAX(sort_order), 0)::INT + 10 AS next FROM category
      `;

      const row = definedColumns({
        id: uuidv7(),
        name: draft.name,
        color_token: draft.color_token,
        parent_id: draft.parent_id,
        auto_rule:
          draft.auto_rule === undefined ? undefined : sql.json(draft.auto_rule as never),
        sort_order: last?.next ?? 10,
      });

      const rows = await sql<Row[]>`INSERT INTO category ${sql(row)} RETURNING *`;
      const created = rows[0];

      if (created === undefined) {
        return failure(getRepositoryError(new Error('insert de categoria sem retorno')));
      }

      return success(parseCategoryFromDB(created));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  update: async (id: string, patch: CategoryWrite) => {
    const changes = definedColumns({
      name: patch.name,
      color_token: patch.color_token,
      parent_id: patch.parent_id,
      auto_rule:
        patch.auto_rule === undefined ? undefined : sql.json(patch.auto_rule as never),
    });

    try {
      const rows = hasChanges(changes)
        ? await sql<
            Row[]
          >`UPDATE category SET ${sql(changes)} WHERE id = ${id} RETURNING *`
        : await sql<Row[]>`SELECT * FROM category WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseCategoryFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  delete: async (id: string) => {
    try {
      const rows = await sql<Row[]>`DELETE FROM category WHERE id = ${id} RETURNING id`;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  usage: async (id: string) => {
    try {
      const [row] = await sql<{ children: number; assets: number; targets: number }[]>`
        SELECT (SELECT COUNT(*)::INT FROM category WHERE parent_id = ${id}) AS children,
               (SELECT COUNT(*)::INT FROM asset WHERE category_id = ${id}) AS assets,
               (SELECT COUNT(*)::INT FROM strategy_target WHERE category_id = ${id}) AS targets
      `;

      return success({
        children: row?.children ?? 0,
        assets: row?.assets ?? 0,
        targets: row?.targets ?? 0,
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listTargets: async () => {
    try {
      const rows = await sql<
        { portfolio_id: string; portfolio_name: string; category_id: string }[]
      >`
        SELECT target.portfolio_id::TEXT AS portfolio_id,
               portfolio.name AS portfolio_name,
               target.category_id::TEXT AS category_id
          FROM strategy_target target
          JOIN portfolio ON portfolio.id = target.portfolio_id
      `;

      return success(rows.map((row) => ({ ...row })));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
