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
 * `age --decrypt | pg_restore -f - | psql --single-transaction`: tudo ou nada.
 *
 * `pg_restore --clean` não serve aqui: o banco tem tabelas particionadas, e o
 * `DROP CONSTRAINT` das partições herdadas falha. Em vez disso o dump vira um
 * script SQL e o `psql` o roda numa transação só, precedido de
 * `DROP SCHEMA public CASCADE; CREATE SCHEMA public`. Se qualquer passo falhar,
 * a transação desfaz — inclusive a limpeza — e os dados atuais ficam como estão.
 */
export const restoreEncryptedDump = async (options: {
  readonly connection: string;
  readonly file: string;
  readonly identityPath: string;
}): Promise<void> => {
  const decrypt = spawn('age', ['--decrypt', '-i', options.identityPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const script = spawn('pg_restore', ['--no-owner', '--no-privileges', '-f', '-'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const apply = spawn(
    'psql',
    [
      '--single-transaction',
      '--no-psqlrc',
      '--quiet',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
      '-f',
      '-',
      options.connection,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const errors: string[] = [];
  decrypt.stderr.on('data', (c: Buffer) => errors.push(`age: ${c.toString()}`));
  script.stderr.on('data', (c: Buffer) => errors.push(`pg_restore: ${c.toString()}`));
  apply.stderr.on('data', (c: Buffer) => errors.push(`psql: ${c.toString()}`));
  apply.stdout.resume();

  const closed = (child: ReturnType<typeof spawn>): Promise<number> =>
    new Promise<number>((resolve) => {
      child.on('close', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(127));
    });
  const ageClosed = closed(decrypt);
  const scriptClosed = closed(script);
  const applyClosed = closed(apply);

  // O `psql` só recebe o fim da entrada — e, com ele, o COMMIT — quando o `age` e
  // o `pg_restore` terminaram bem. Se algum falhou, o script termina num
  // comando que dá erro: `ON_ERROR_STOP` aborta e a transação desfaz tudo,
  // inclusive o `DROP SCHEMA`. Entrada vazia por chave errada não apaga nada.
  script.stdout.pipe(apply.stdin, { end: false });
  const scriptEnded = new Promise<void>((resolve) => script.stdout.on('end', resolve));
  apply.stdin.on('error', () => undefined);
  void (async () => {
    const [age, restore] = await Promise.all([ageClosed, scriptClosed]);
    await scriptEnded;
    apply.stdin.end(age === 0 && restore === 0 ? '' : 'SELECT 1/0;\n');
  })();

  decrypt.stdin.on('error', () => undefined);
  script.stdin.on('error', () => undefined);
  await Promise.allSettled([
    pipeline(createReadStream(options.file), decrypt.stdin),
    pipeline(decrypt.stdout, script.stdin),
  ]);
  const codes = Promise.all([ageClosed, scriptClosed, applyClosed]);
  const [ageCode, restoreCode, psqlCode] = await codes;
  if (ageCode !== 0 || restoreCode !== 0 || psqlCode !== 0) {
    throw new Error(
      `restauração falhou e nada foi alterado (age ${ageCode}, pg_restore ${restoreCode}, psql ${psqlCode}): ${errors.join(' ').trim()}`,
    );
  }
};
