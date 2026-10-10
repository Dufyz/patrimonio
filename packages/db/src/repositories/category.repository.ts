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

/** `jsonb` precisa ir como texto: objeto cru o driver trataria como array. */
const asJsonb = (
  value: Record<string, unknown> | null | undefined,
): string | null | undefined =>
  value === undefined ? undefined : value === null ? null : JSON.stringify(value);

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
    const row = definedColumns({
      id: uuidv7(),
      parent_id: draft.parent_id,
      name: draft.name,
      color_token: draft.color_token,
      auto_rule: asJsonb(draft.auto_rule),
      sort_order: draft.sort_order,
    });

    try {
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
    const changes = definedColumns({ ...patch, auto_rule: asJsonb(patch.auto_rule) });

    try {
      const rows = hasChanges(changes)
        ? await sql<Row[]>`
            UPDATE category SET ${sql(changes)} WHERE id = ${id} RETURNING *
          `
        : await sql<Row[]>`SELECT * FROM category WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseCategoryFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  remove: async (id: string) => {
    try {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM category WHERE id = ${id} RETURNING id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  usage: async (id: string) => {
    try {
      const rows = await sql<{ assets: string; targets: string; children: string }[]>`
        SELECT (SELECT COUNT(*) FROM asset WHERE category_id = ${id})::TEXT AS assets,
               (SELECT COUNT(*) FROM strategy_target WHERE category_id = ${id})::TEXT
                 AS targets,
               (SELECT COUNT(*) FROM category WHERE parent_id = ${id})::TEXT AS children
      `;
      const row = rows[0];

      return success({
        assets: Number(row?.assets ?? 0),
        targets: Number(row?.targets ?? 0),
        children: Number(row?.children ?? 0),
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
