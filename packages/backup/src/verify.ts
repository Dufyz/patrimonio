import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BackupStorage } from './storage.js';

const sha256 = async (path: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

/**
 * BKP-02 · Relê o objeto no destino e compara o conteúdo com o arquivo que
 * saiu daqui. A chave privada do `age` não está no servidor, então decifrar
 * não é possível; o que se garante é que os bytes que chegaram ao bucket são
 * exatamente os que foram cifrados — o que cobre upload truncado e corrompido.
 */
export const sameContentAtDestination = async (
  storage: BackupStorage,
  name: string,
  localPath: string,
): Promise<boolean> => {
  const dir = await mkdtemp(join(tmpdir(), 'verify-'));
  try {
    const back = join(dir, 'back.dump.age');
    await storage.download(name, back);
    return (await sha256(back)) === (await sha256(localPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
