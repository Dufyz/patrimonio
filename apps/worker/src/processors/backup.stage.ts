import { AppError, BadRequestError, ExternalServiceError } from '@patrimonio/application';
import { dedupeKey } from '@patrimonio/domain';
import { environment } from '@patrimonio/env';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';
import type { Worker } from 'bullmq';

import {
  BackupToolMissingError,
  backupFileName,
  createEncryptedDump,
  isManualBackup,
} from '../infra/backup/dump.js';
import { applyRetention } from '../infra/backup/retention.js';
import { createBackupStorage } from '../infra/backup/storage.js';
import type { BackupStorage } from '../infra/backup/storage.js';
import { defineStage } from '../infra/define-stage.js';
import type { StageDeps, StageJobData } from '../infra/define-stage.js';

export type BackupReport = {
  readonly skipped: boolean;
  readonly name?: string;
  readonly bytes?: number;
  readonly duration_ms?: number;
  readonly removed?: number;
};

export type BackupConfig = {
  readonly enabled: boolean;
  readonly publicKey: string | undefined;
  readonly connection: string;
};

export type BackupStageDeps = StageDeps & {
  /** Injetáveis no teste; em produção vêm de `env` e do disco. */
  readonly storage?: BackupStorage;
  readonly config?: BackupConfig;
  readonly dump?: typeof createEncryptedDump;
  /** A versão do esquema que vai no nome do arquivo (número de migrations aplicadas). */
  readonly schemaVersion?: () => Promise<string | undefined>;
};

export type BackupRun = {
  /** "Fazer backup agora": mesma rotina, sem mexer na retenção dos diários. */
  readonly manual?: boolean;
};

const storageFor = (deps: BackupStageDeps): BackupStorage | AppError => {
  if (deps.storage !== undefined) return deps.storage;

  const { storageUrl, storageToken, bucket } = environment.backup;

  if (storageUrl === undefined || storageToken === undefined) {
    return new BadRequestError('backup ligado sem destino configurado');
  }

  return createBackupStorage({ baseUrl: storageUrl, token: storageToken, bucket });
};

/**
 * 03:00: dump cifrado para o bucket, retenção aplicada, tamanho e duração
 * registrados. A falha fica gravada no evento da outbox, que é o que o painel
 * Requer atenção lê.
 */
export const runBackup = async (
  deps: BackupStageDeps,
  referenceDate: string,
  run: BackupRun = {},
): Promise<Either<AppError, BackupReport>> => {
  const config: BackupConfig = deps.config ?? {
    enabled: environment.backup.enabled,
    publicKey: environment.backup.publicKey,
    connection: environment.database.connection,
  };

  if (!config.enabled) {
    deps.logger.info('backup desligado nesta instalação: nada a fazer');
    return success({ skipped: true });
  }

  const recipient = config.publicKey;
  if (recipient === undefined) {
    return failure(new BadRequestError('BACKUP_PUBLIC_KEY ausente'));
  }

  const storage = storageFor(deps);
  if (storage instanceof AppError) return failure(storage);

  let cleanup: (() => Promise<void>) | undefined;

  try {
    const dump = await (deps.dump ?? createEncryptedDump)({
      connection: config.connection,
      recipient,
      date: referenceDate,
    });
    cleanup = dump.cleanup;

    const schema = await deps.schemaVersion?.();
    const manualAt =
      run.manual === true
        ? deps.clock.now().toISOString().slice(11, 16).replace(':', '')
        : undefined;
    const name = backupFileName(referenceDate, {
      ...(schema === undefined ? {} : { schema }),
      ...(manualAt === undefined ? {} : { manualAt }),
    });
    await storage.upload(name, dump.path);

    // Verificação: o arquivo precisa estar no destino com o tamanho que saiu daqui.
    // Se não estiver, o backup é dado como falho, o arquivo ruim sai e os
    // anteriores ficam como estão — a retenção só roda sobre um backup verificado.
    const stored = await storage.size(name);
    if (stored !== dump.bytes) {
      await storage.remove([name]);
      return failure(
        new ExternalServiceError(
          `backup falhou na verificação: esperado ${dump.bytes} bytes, destino tem ${stored ?? 'nada'}`,
        ),
      );
    }

    // O manual não conta como diário, e a retenção não o apaga nem o considera.
    const plan =
      run.manual === true
        ? { keep: [], remove: [] as string[] }
        : applyRetention(
            (await storage.list()).filter((entry) => !isManualBackup(entry.name)),
            referenceDate,
          );
    await storage.remove(plan.remove);

    deps.logger.info(
      {
        name,
        bytes: dump.bytes,
        duration_ms: dump.durationMs,
        kept: plan.keep.length,
        removed: plan.remove.length,
      },
      'backup cifrado no bucket',
    );

    return success({
      skipped: false,
      name,
      bytes: dump.bytes,
      duration_ms: dump.durationMs,
      removed: plan.remove.length,
    });
  } catch (error) {
    // Ferramenta ausente não se resolve tentando de novo; rede e Storage sim.
    if (error instanceof BackupToolMissingError) {
      return failure(new BadRequestError(error.message));
    }

    return failure(
      new ExternalServiceError(
        error instanceof Error ? error.message : 'backup falhou por motivo desconhecido',
      ),
    );
  } finally {
    await cleanup?.();
  }
};

export const backupStage = (deps: BackupStageDeps): Worker<StageJobData> =>
  defineStage(
    {
      stage: 'backup',
      run: async (job) => {
        const referenceDate =
          typeof job.data['reference_date'] === 'string'
            ? job.data['reference_date']
            : deps.clock.today();

        return runBackup(deps, referenceDate, { manual: job.data['manual'] === true });
      },
      scheduledEvent: (stageDeps) => ({
        stage: 'backup',
        dedupe_key: dedupeKey.backup(stageDeps.clock.today()),
        payload: { reference_date: stageDeps.clock.today() },
      }),
    },
    deps,
  );
