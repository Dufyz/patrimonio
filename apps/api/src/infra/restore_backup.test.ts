import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createEncryptedDump } from '@patrimonio/backup';
import type { BackupStorage } from '@patrimonio/backup';
import {
  closeDatabase,
  createConnection,
  loadFinanceDemo,
  migrationStatus,
  removeFinanceDemo,
  runMigrations,
} from '@patrimonio/db';
import type { Sql } from '@patrimonio/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createMaintenance } from './maintenance.js';
import { restoreBackup } from './restore_backup.js';

/**
 * BKP-03 · A restauração de verdade: `pg_dump` e `age` num banco descartável,
 * `pg_restore` de volta, e a trava de manutenção em volta.
 */
const ADMIN =
  process.env['DB_TEST_CONNECTION'] ??
  'postgres://patrimonio:patrimonio@localhost:5434/patrimonio_test';
const SCRATCH_NAME = 'patrimonio_restore_scratch';
const SCRATCH = ADMIN.replace(/\/[^/]+$/, `/${SCRATCH_NAME}`);

let admin: Sql;
let scratch: Sql;
let dir: string;
let identity: string;
let recipient: string;
let backupName: string;
let dumpPath: string;
let entries: number;
const uploaded: string[] = [];

const storage: BackupStorage = {
  upload: async (name) => {
    uploaded.push(name);
  },
  download: async (_name, path) => {
    await copyFile(dumpPath, path);
  },
  list: async () => [],
  remove: async () => undefined,
  size: async () => null,
};

const count = async (): Promise<number> => {
  const [row] = await scratch<
    { n: number }[]
  >`SELECT COUNT(*)::INTEGER AS n FROM fin_entry`;
  return row?.n ?? 0;
};

const restorer = (extra: Partial<Parameters<typeof restoreBackup>[0]> = {}) =>
  restoreBackup({
    maintenance: createMaintenance(),
    now: () => new Date('2026-11-16T12:30:00.000Z'),
    connection: SCRATCH,
    recipient,
    storage,
    afterRestore: async () => undefined,
    ...extra,
  });

beforeAll(async () => {
  admin = createConnection({
    connection: ADMIN,
    poolSize: 1,
    applicationName: 'restore-test',
  });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_NAME} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${SCRATCH_NAME}`);
  await runMigrations(SCRATCH);
  scratch = createConnection({
    connection: SCRATCH,
    poolSize: 2,
    applicationName: 'restore-test',
  });
  await loadFinanceDemo(scratch);
  entries = await count();

  dir = await mkdtemp(join(tmpdir(), 'restore-test-'));
  const keyFile = join(dir, 'key.txt');
  execFileSync('age-keygen', ['-o', keyFile], { stdio: 'pipe' });
  identity = await readFile(keyFile, 'utf8');
  recipient = /public key: (age1\w+)/.exec(identity)?.[1] ?? '';

  const schema = String((await migrationStatus(SCRATCH)).applied.length).padStart(3, '0');
  backupName = `patrimonio-2026-11-12-s${schema}.dump.age`;
  const dump = await createEncryptedDump({
    connection: SCRATCH,
    recipient,
    date: '2026-11-12',
  });
  dumpPath = join(dir, 'backup.dump.age');
  await copyFile(dump.path, dumpPath);
  await dump.cleanup();
}, 120_000);

afterAll(async () => {
  await closeDatabase(scratch);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_NAME} WITH (FORCE)`);
  await closeDatabase(admin);
  await rm(dir, { recursive: true, force: true });
});

describe('restauração (BKP-03)', () => {
  it('a base de teste tem lançamentos para perder', () => {
    expect(entries).toBeGreaterThan(0);
  });

  it('recusa backup de esquema mais novo sem tocar em nada', async () => {
    const result = await restorer()({
      name: 'patrimonio-2026-11-12-s999.dump.age',
      identity,
    });
    expect(result.isFailure()).toBe(true);
    expect(String((result.value as Error).message)).toMatch(/mais novo/);
    expect(uploaded).toEqual([]);
    expect(await count()).toBe(entries);
  });

  it('chave errada falha e mantém os dados atuais (tudo ou nada)', async () => {
    const wrong = execFileSync('age-keygen', { encoding: 'utf8' });
    const result = await restorer()({ name: backupName, identity: wrong });
    expect(result.isFailure()).toBe(true);
    expect(await count()).toBe(entries);
  });

  it('restaura o backup, em manutenção, com backup de segurança antes', async () => {
    const before = uploaded.length;
    await removeFinanceDemo(scratch);
    expect(await count()).toBe(0);

    const maintenance = createMaintenance();
    let during = false;
    const afterRestore = vi.fn(async () => undefined);
    const result = await restoreBackup({
      maintenance,
      now: () => new Date('2026-11-16T12:30:00.000Z'),
      connection: SCRATCH,
      recipient,
      storage,
      afterRestore,
      perform: async (options) => {
        during = maintenance.active();
        const { performRestore } = await import('@patrimonio/backup');
        return performRestore(options);
      },
    })({ name: backupName, identity });

    expect(result.isSuccess(), String((result.value as Error).message)).toBe(true);
    expect(during).toBe(true);
    expect(maintenance.active()).toBe(false);
    expect(await count()).toBe(entries);
    expect(uploaded).toHaveLength(before + 1);
    expect(uploaded.at(-1)).toMatch(/-manual-\d{4}-s\d+\.dump\.age$/);
    expect(afterRestore).toHaveBeenCalledOnce();
  }, 120_000);
});

describe('modo de manutenção (BKP-03)', () => {
  it('escritas são recusadas com 503 enquanto restaura; leituras e a rota passam', async () => {
    const maintenance = createMaintenance();
    const call = (method: string, path: string) => {
      const next = vi.fn();
      const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      maintenance.middleware({ method, path } as never, response as never, next);
      return { next, response };
    };

    await maintenance.during(async () => {
      expect(call('POST', '/api/portfolios').response.status).toHaveBeenCalledWith(503);
      expect(call('DELETE', '/api/data').next).not.toHaveBeenCalled();
      expect(call('GET', '/api/overview').next).toHaveBeenCalled();
      expect(call('POST', '/api/backup/restore').next).toHaveBeenCalled();
    });
    expect(call('POST', '/api/portfolios').next).toHaveBeenCalled();
  });

  it('o modo desliga mesmo quando a restauração falha', async () => {
    const maintenance = createMaintenance();
    await expect(
      maintenance.during(async () => {
        throw new Error('falhou');
      }),
    ).rejects.toThrow();
    expect(maintenance.active()).toBe(false);
  });
});
