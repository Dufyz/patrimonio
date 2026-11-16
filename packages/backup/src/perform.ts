import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DateOnly } from '@patrimonio/domain';

import { backupFileName, createEncryptedDump } from './dump.js';
import { checkRestorable, restoreEncryptedDump } from './restore.js';
import type { BackupStorage } from './storage.js';

/** O backup não pode ser restaurado (nome inválido, esquema mais novo). Nada foi tocado. */
export class RestoreRefusedError extends Error {}

export type PerformRestoreOptions = {
  readonly name: string;
  /** O conteúdo da chave privada do `age`. Vai para um arquivo temporário 0600 e some no fim. */
  readonly identity: string;
  readonly connection: string;
  /** A versão do esquema do app (número de migrations aplicadas, 3 dígitos). */
  readonly currentSchema: string;
  readonly recipient: string;
  readonly storage: BackupStorage;
  readonly today: DateOnly;
  /** `HHMM` do momento, para o nome do backup de segurança. */
  readonly clockTime: string;
  /** Injetáveis no teste. */
  readonly dump?: typeof createEncryptedDump;
  readonly restore?: typeof restoreEncryptedDump;
};

/**
 * BKP-03 · O caminho completo da restauração, igual para a tela e para o
 * comando do operador:
 *
 * 1. recusa backup de esquema mais novo (antes de tocar em qualquer coisa);
 * 2. grava um backup de segurança do estado atual no mesmo bucket;
 * 3. baixa o arquivo escolhido e restaura numa transação só (tudo ou nada).
 *
 * A chave privada só existe em disco durante a chamada.
 */
export const performRestore = async (
  options: PerformRestoreOptions,
): Promise<{ readonly safety: string }> => {
  const verdict = checkRestorable(options.name, options.currentSchema);
  if (!verdict.ok) throw new RestoreRefusedError(verdict.reason);

  const dir = await mkdtemp(join(tmpdir(), 'restore-'));
  try {
    const identityPath = join(dir, 'identity.txt');
    await writeFile(identityPath, options.identity, { mode: 0o600 });

    const safety = await (options.dump ?? createEncryptedDump)({
      connection: options.connection,
      recipient: options.recipient,
      date: options.today,
    });
    const safetyName = backupFileName(options.today, {
      schema: options.currentSchema,
      manualAt: `pre${options.clockTime}`.replace(/[^0-9]/g, ''),
    });
    try {
      await options.storage.upload(safetyName, safety.path);
    } finally {
      await safety.cleanup();
    }

    const local = join(dir, 'backup.dump.age');
    await options.storage.download(options.name, local);
    await (options.restore ?? restoreEncryptedDump)({
      connection: options.connection,
      file: local,
      identityPath,
    });
    return { safety: safetyName };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
