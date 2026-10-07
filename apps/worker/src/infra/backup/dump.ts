import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { DateOnly } from '@patrimonio/domain';

/**
 * `pg_dump --format=custom` cifrado com `age` antes de sair da máquina. A chave
 * privada não fica na VPS nem no Storage: fica no gerenciador de senhas, e é o
 * que faz um Storage comprometido entregar dumps cifrados e nada mais.
 *
 * O dump inclui as projeções. É desperdício de espaço em tese, e é o que torna
 * a restauração instantânea em vez de exigir um recálculo de dez anos.
 */
export type DumpOptions = {
  readonly connection: string;
  readonly recipient: string;
  readonly date: DateOnly;
};

export type DumpResult = {
  readonly path: string;
  readonly bytes: number;
  readonly durationMs: number;
  readonly cleanup: () => Promise<void>;
};

export class BackupToolMissingError extends Error {
  constructor(tool: string) {
    super(
      `${tool} não está instalado: o backup cifrado precisa de pg_dump e age no PATH`,
    );
    this.name = 'BackupToolMissingError';
  }
}

/**
 * Spawn com os canos garantidos: o tipo do `spawn` os declara anuláveis, e
 * seguir sem conferir é como o dump acabaria vazio sem ninguém notar.
 */
const run = (command: string, args: readonly string[], withStdin: boolean) => {
  const child = spawn(command, [...args], {
    stdio: [withStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  const { stdout, stderr } = child;
  if (stdout === null || stderr === null) {
    throw new Error(`${command} não abriu os canos de saída`);
  }

  if (withStdin && child.stdin === null) {
    throw new Error(`${command} não abriu o cano de entrada`);
  }

  return { child, stdout, stderr, stdin: child.stdin };
};

const toolExists = async (tool: string): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = spawn('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' });
    probe.on('close', (code) => resolve(code === 0));
    probe.on('error', () => resolve(false));
  });

export const backupFileName = (date: DateOnly): string => `patrimonio-${date}.dump.age`;

export const createEncryptedDump = async (options: DumpOptions): Promise<DumpResult> => {
  for (const tool of ['pg_dump', 'age']) {
    if (!(await toolExists(tool))) throw new BackupToolMissingError(tool);
  }

  const startedAt = Date.now();
  const path = join(tmpdir(), backupFileName(options.date));

  const dump = run(
    'pg_dump',
    ['--format=custom', '--no-owner', options.connection],
    false,
  );
  const encrypt = run('age', ['--encrypt', '--recipient', options.recipient], true);
  const encryptStdin = encrypt.stdin;

  if (encryptStdin === null) throw new Error('age não aceitou a entrada do dump');

  const errors: string[] = [];
  dump.stderr.on('data', (chunk: Buffer) => errors.push(`pg_dump: ${chunk.toString()}`));
  encrypt.stderr.on('data', (chunk: Buffer) => errors.push(`age: ${chunk.toString()}`));

  // Os dois trechos correm juntos: encadear os `await` deixaria a saída do age
  // acumulando em buffer até travar o processo.
  const [dumpCode, encryptCode] = await Promise.all([
    new Promise<number>((resolve) =>
      dump.child.on('close', (code) => resolve(code ?? 1)),
    ),
    new Promise<number>((resolve) =>
      encrypt.child.on('close', (code) => resolve(code ?? 1)),
    ),
    pipeline(dump.stdout, encryptStdin),
    pipeline(encrypt.stdout, createWriteStream(path)),
  ]);

  if (dumpCode !== 0 || encryptCode !== 0) {
    await unlink(path).catch(() => undefined);
    throw new Error(
      `dump falhou (pg_dump ${dumpCode}, age ${encryptCode}): ${errors.join(' ').trim()}`,
    );
  }

  const { size } = await stat(path);

  return {
    path,
    bytes: size,
    durationMs: Date.now() - startedAt,
    cleanup: async () => {
      await unlink(path).catch(() => undefined);
    },
  };
};
