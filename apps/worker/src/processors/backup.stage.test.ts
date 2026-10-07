import { unwrapFailure, unwrapSuccess } from '@patrimonio/shared/testing';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { BackupToolMissingError } from '../infra/backup/dump.js';
import type { BackupEntry } from '../infra/backup/retention.js';
import type { BackupStorage } from '../infra/backup/storage.js';
import { runBackup } from './backup.stage.js';
import type { BackupStageDeps } from './backup.stage.js';

const silent = pino({ level: 'silent' });

const fakeStorage = (existing: readonly BackupEntry[]) => {
  const uploaded: Array<{ name: string; path: string }> = [];
  const removed: string[] = [];

  const storage: BackupStorage = {
    upload: async (name, path) => {
      uploaded.push({ name, path });
    },
    list: async () => [...existing],
    remove: async (names) => {
      removed.push(...names);
    },
  };

  return { storage, uploaded, removed };
};

const depsWith = (
  overrides: Partial<BackupStageDeps> & { storage?: BackupStorage },
): BackupStageDeps =>
  ({
    connection: undefined,
    unitOfWork: undefined,
    outbox: undefined,
    clock: { now: () => new Date('2026-10-06T03:00:00.000Z'), today: () => '2026-10-06' },
    logger: silent,
    config: { enabled: true, publicKey: 'age1teste', connection: 'postgres://x/y' },
    dump: async () => ({
      path: '/tmp/patrimonio-2026-10-06.dump.age',
      bytes: 1_234,
      durationMs: 42,
      cleanup: async () => undefined,
    }),
    ...overrides,
  }) as BackupStageDeps;

describe('backup', () => {
  it('desligado não faz nada, e diz que não fez', async () => {
    const { storage, uploaded } = fakeStorage([]);
    const report = unwrapSuccess(
      await runBackup(
        depsWith({
          storage,
          config: { enabled: false, publicKey: undefined, connection: 'postgres://x/y' },
        }),
        '2026-10-06',
      ),
    );

    expect(report.skipped).toBe(true);
    expect(uploaded).toEqual([]);
  });

  it('ligado sem chave pública não tenta cifrar nada', async () => {
    const { storage, uploaded } = fakeStorage([]);
    const error = unwrapFailure(
      await runBackup(
        depsWith({
          storage,
          config: { enabled: true, publicKey: undefined, connection: 'postgres://x/y' },
        }),
        '2026-10-06',
      ),
    );

    expect(error.statusCode).toBe(400);
    expect(uploaded).toEqual([]);
  });

  it('o dump do dia aparece no bucket com o nome da data', async () => {
    const { storage, uploaded } = fakeStorage([]);
    const report = unwrapSuccess(await runBackup(depsWith({ storage }), '2026-10-06'));

    expect(uploaded).toEqual([
      {
        name: 'patrimonio-2026-10-06.dump.age',
        path: '/tmp/patrimonio-2026-10-06.dump.age',
      },
    ]);
    expect(report).toMatchObject({ skipped: false, bytes: 1_234, duration_ms: 42 });
  });

  it('a retenção remove o que saiu das três faixas', async () => {
    const { storage, removed } = fakeStorage([
      { name: 'patrimonio-2026-10-05.dump.age', date: '2026-10-05' },
      { name: 'patrimonio-2026-10-06.dump.age', date: '2026-10-06' },
      // Fora dos seis meses: sai.
      { name: 'patrimonio-2025-01-10.dump.age', date: '2025-01-10' },
    ]);

    const report = unwrapSuccess(await runBackup(depsWith({ storage }), '2026-10-06'));

    expect(removed).toEqual(['patrimonio-2025-01-10.dump.age']);
    expect(report.removed).toBe(1);
  });

  it('ferramenta ausente é falha definitiva: tentar de novo não instala o age', async () => {
    const { storage } = fakeStorage([]);
    const error = unwrapFailure(
      await runBackup(
        depsWith({
          storage,
          dump: async () => {
            throw new BackupToolMissingError('age');
          },
        }),
        '2026-10-06',
      ),
    );

    expect(error.statusCode).toBe(400);
    expect(error.message).toContain('age');
  });

  it('falha de rede no Storage é transitória: o job tenta de novo', async () => {
    const error = unwrapFailure(
      await runBackup(
        depsWith({
          storage: {
            upload: async () => {
              throw new Error('ECONNRESET');
            },
            list: async () => [],
            remove: async () => undefined,
          },
        }),
        '2026-10-06',
      ),
    );

    expect(error.statusCode).toBe(502);
    expect(error.isTransient).toBe(true);
  });

  it('o arquivo temporário é apagado mesmo quando o upload falha', async () => {
    let cleaned = false;

    await runBackup(
      depsWith({
        storage: {
          upload: async () => {
            throw new Error('falhou');
          },
          list: async () => [],
          remove: async () => undefined,
        },
        dump: async () => ({
          path: '/tmp/x.dump.age',
          bytes: 1,
          durationMs: 1,
          cleanup: async () => {
            cleaned = true;
          },
        }),
      }),
      '2026-10-06',
    );

    expect(cleaned).toBe(true);
  });
});
