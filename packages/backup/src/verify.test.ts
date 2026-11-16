import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BackupStorage } from './storage.js';
import { sameContentAtDestination } from './verify.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'verify-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const storageReturning = (content: string): BackupStorage => ({
  upload: async () => undefined,
  list: async () => [],
  remove: async () => undefined,
  size: async () => null,
  download: async (_name, path) => writeFile(path, content),
});

describe('BKP-02 · conferência do que chegou ao destino', () => {
  it('mesmo conteúdo passa; um byte diferente reprova', async () => {
    const local = join(dir, 'local.age');
    await writeFile(local, 'conteudo-cifrado');
    expect(
      await sameContentAtDestination(storageReturning('conteudo-cifrado'), 'x', local),
    ).toBe(true);
    expect(
      await sameContentAtDestination(storageReturning('conteudo-cifrada'), 'x', local),
    ).toBe(false);
    expect(await sameContentAtDestination(storageReturning('conteudo'), 'x', local)).toBe(
      false,
    );
  });
});
