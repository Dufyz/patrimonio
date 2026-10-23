import type { InstitutionRepository } from '@patrimonio/application';
import { parseInstitutionFromDB } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

type Row = Record<string, unknown>;

export const createInstitutionRepository = (sql: Connection): InstitutionRepository => ({
  findById: async (id: string) => {
    try {
      const rows = await sql<Row[]>`SELECT * FROM institution WHERE id = ${id}`;
      const row = rows[0];

      return success(row === undefined ? null : parseInstitutionFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  list: async () => {
    try {
      const rows = await sql<Row[]>`SELECT * FROM institution ORDER BY LOWER(name)`;

      return success(rows.map((row) => parseInstitutionFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
