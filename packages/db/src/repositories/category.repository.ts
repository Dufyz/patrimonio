import type { CategoryRepository } from '@patrimonio/application';
import { parseCategoryFromDB } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

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
});
