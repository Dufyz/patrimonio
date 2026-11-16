import { performRestore, RestoreRefusedError } from '@patrimonio/backup';
import type { BackupStorage } from '@patrimonio/backup';
import type { AppError} from '@patrimonio/application';
import { BadRequestError, ExternalServiceError } from '@patrimonio/application';
import { migrationStatus, runMigrations } from '@patrimonio/db';
import { environment } from '@patrimonio/env';
import { createBackupStorage } from '@patrimonio/backup';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { Maintenance } from './maintenance.js';

export type RestoreInput = {
  readonly name: string;
  /** A chave privada do `age`, digitada ou enviada na hora; nunca fica guardada. */
  readonly identity: string;
};

export type RestoreOutput = { readonly safety: string };

export type RestoreBackupDeps = {
  readonly maintenance: Maintenance;
  readonly now: () => Date;
  /** O banco que será trocado; por padrão, o do app. */
  readonly connection?: string;
  /** A chave pública do `age` do backup de segurança; por padrão, a do ambiente. */
  readonly recipient?: string;
  /** Injetáveis no teste. */
  readonly storage?: BackupStorage;
  readonly perform?: typeof performRestore;
  readonly schemaVersion?: () => Promise<string>;
  readonly migrate?: () => Promise<void>;
  /** Pede a sincronização de mercado (e, por ela, o recálculo das carteiras). */
  readonly afterRestore?: () => Promise<void>;
};

/**
 * BKP-03 · Restaura um backup pela tela. Em modo de manutenção: backup de
 * segurança, `pg_restore` numa transação (tudo ou nada), migrações pendentes e,
 * por fim, o pedido de sincronização de mercado que recalcula as carteiras.
 */
export const restoreBackup =
  (deps: RestoreBackupDeps) =>
  async (input: RestoreInput): Promise<Either<AppError, RestoreOutput>> => {
    if (deps.maintenance.active()) {
      return failure(new BadRequestError('Já há uma restauração em andamento.'));
    }

    const { enabled, storageUrl, storageToken, bucket } = environment.backup;
    const publicKey = deps.recipient ?? environment.backup.publicKey;
    const connection = deps.connection ?? environment.database.connection;
    const storage =
      deps.storage ??
      (enabled && storageUrl !== undefined && storageToken !== undefined
        ? createBackupStorage({ baseUrl: storageUrl, token: storageToken, bucket })
        : null);
    if (storage === null || publicKey === undefined) {
      return failure(
        new BadRequestError(
          'O backup está desligado ou sem destino nesta instalação; não há o que restaurar.',
        ),
      );
    }

    const now = deps.now();
    try {
      const schema = await (
        deps.schemaVersion ??
        (async () =>
          String((await migrationStatus(connection)).applied.length).padStart(3, '0'))
      )();
      const result = await deps.maintenance.during(async () => {
        const done = await (deps.perform ?? performRestore)({
          name: input.name,
          identity: input.identity,
          connection,
          currentSchema: schema,
          recipient: publicKey,
          storage,
          today: now.toISOString().slice(0, 10),
          clockTime: now.toISOString().slice(11, 16),
        });
        // Backup de esquema mais velho traz tabelas de então: sobe até o de hoje.
        await (deps.migrate ?? (async () => void (await runMigrations(connection))))();
        return done;
      });
      await deps.afterRestore?.();
      return success({ safety: result.safety });
    } catch (error) {
      if (error instanceof RestoreRefusedError) {
        return failure(new BadRequestError(error.message));
      }
      return failure(
        new ExternalServiceError(
          error instanceof Error
            ? error.message
            : 'a restauração falhou e os dados atuais foram mantidos',
        ),
      );
    }
  };
