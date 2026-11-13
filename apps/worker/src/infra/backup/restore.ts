import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/**
 * BKP-03 · Restaurar um backup cifrado.
 *
 * A chave privada do `age` não mora no servidor (ver dump.ts): quem restaura a
 * entrega por arquivo (`--identity`), no momento. Por isso a restauração é um
 * comando de operador, não uma rota: a API nunca vê a chave.
 */
export const CONFIRMATION_WORD = 'RESTAURAR';

/** `patrimonio-2026-11-12-s039.dump.age` → `{ date, schema, manual }`. */
export const parseBackupName = (
  name: string,
): {
  readonly date: string;
  readonly schema: string | null;
  readonly manual: boolean;
} | null => {
  const match =
    /^patrimonio-(\d{4}-\d{2}-\d{2})((?:-manual-\d{4})?)(?:-s(\d+))?\.dump\.age$/.exec(
      name,
    );
  if (match === null || match[1] === undefined) return null;
  return { date: match[1], schema: match[3] ?? null, manual: match[2] !== '' };
};

export type Restorable =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Esquema mais novo que o do app é recusado; mais antigo ou igual cabe. */
export const checkRestorable = (name: string, currentSchema: string): Restorable => {
  const parsed = parseBackupName(name);
  if (parsed === null) {
    return { ok: false, reason: `"${name}" não parece um backup do Patrimônio.` };
  }
  if (parsed.schema === null) {
    return {
      ok: false,
      reason: 'O nome do backup não traz a versão do esquema; não dá para conferir.',
    };
  }
  if (Number(parsed.schema) > Number(currentSchema)) {
    return {
      ok: false,
      reason: `Backup do esquema ${parsed.schema} é mais novo que o do app (${currentSchema}). Atualize o app antes de restaurar.`,
    };
  }
  return { ok: true };
};

/** A confirmação digitada precisa ser exatamente a palavra. */
export const confirmed = (typed: string | undefined): boolean =>
  typed === CONFIRMATION_WORD;

/**
 * `age --decrypt | pg_restore --clean --single-transaction`: tudo ou nada. Se
 * qualquer passo falhar, a transação desfaz e os dados atuais ficam como estão.
 */
export const restoreEncryptedDump = async (options: {
  readonly connection: string;
  readonly file: string;
  readonly identityPath: string;
}): Promise<void> => {
  const decrypt = spawn('age', ['--decrypt', '-i', options.identityPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const restore = spawn(
    'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--single-transaction',
      '--exit-on-error',
      '-d',
      options.connection,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const errors: string[] = [];
  decrypt.stderr.on('data', (c: Buffer) => errors.push(`age: ${c.toString()}`));
  restore.stderr.on('data', (c: Buffer) => errors.push(`pg_restore: ${c.toString()}`));

  const codes = Promise.all([
    new Promise<number>((resolve) => decrypt.on('close', (c) => resolve(c ?? 1))),
    new Promise<number>((resolve) => restore.on('close', (c) => resolve(c ?? 1))),
  ]);
  await Promise.all([
    pipeline(createReadStream(options.file), decrypt.stdin),
    pipeline(decrypt.stdout, restore.stdin),
  ]);
  const [ageCode, pgCode] = await codes;
  if (ageCode !== 0 || pgCode !== 0) {
    throw new Error(
      `restauração falhou e nada foi alterado (age ${ageCode}, pg_restore ${pgCode}): ${errors.join(' ').trim()}`,
    );
  }
};
