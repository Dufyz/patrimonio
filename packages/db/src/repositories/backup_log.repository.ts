import type { BackupLogRepository } from '@patrimonio/application';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/** O registro dos arquivos de backup: o worker grava, a tela de Configurações lê. */
export const createBackupLogRepository = (sql: Connection): BackupLogRepository => ({
  record: async (file) => {
    try {
      await sql`
        INSERT INTO backup_file (name, taken_on, manual, bytes, schema_version, entries, portfolios)
        VALUES (${file.name}, ${file.taken_on}, ${file.manual}, ${file.bytes}, ${file.schema_version}, ${file.entries}, ${file.portfolios})
        ON CONFLICT (name) DO UPDATE
          SET bytes = EXCLUDED.bytes, schema_version = EXCLUDED.schema_version,
              entries = EXCLUDED.entries, portfolios = EXCLUDED.portfolios
      `;
      return success(undefined);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  forget: async (names) => {
    if (names.length === 0) return success(undefined);
    try {
      await sql`DELETE FROM backup_file WHERE name IN ${sql(names as string[])}`;
      return success(undefined);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
