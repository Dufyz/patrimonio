import { readFile } from 'node:fs/promises';

import { migrationStatus } from '@patrimonio/db';
import { environment } from '@patrimonio/env';

import {
  checkRestorable,
  confirmed,
  CONFIRMATION_WORD,
  createBackupStorage,
  parseBackupName,
  performRestore,
} from '@patrimonio/backup';

/**
 * `pnpm restore --name=<arquivo> --identity=<chave.age> --confirm=RESTAURAR`
 *
 * BKP-03. Substitui TODOS os dados atuais pelo conteúdo do backup. Antes, grava
 * um backup de segurança do estado atual (mesmo bucket, nome `manual`). A
 * restauração é uma transação só: falhou, nada muda. Pare a API e o worker
 * antes (modo de manutenção) e, depois, rode a sincronização de mercado e a
 * suíte de consistência.
 */
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const fail = (line: string): never => {
  process.stderr.write(`${line}\n`);
  process.exit(1);
};

const name = arg('name');
const identity = arg('identity');
if (name === undefined || identity === undefined) {
  fail('uso: restore --name=<arquivo> --identity=<chave.age> --confirm=RESTAURAR');
}
const { storageUrl, storageToken, bucket, publicKey } = environment.backup;
if (storageUrl === undefined || storageToken === undefined || publicKey === undefined) {
  fail('backup sem destino ou chave pública configurados.');
}

const status = await migrationStatus(environment.database.connection);
const current = String(status.applied.length).padStart(3, '0');
const verdict = checkRestorable(name as string, current);
if (!verdict.ok) fail(verdict.reason);

const parsed = parseBackupName(name as string);
say(`Backup de ${parsed?.date ?? '?'} (esquema ${parsed?.schema ?? '?'}).`);
say('ISTO SUBSTITUI TODOS OS DADOS ATUAIS.');
if (!confirmed(arg('confirm'))) {
  fail(`Para seguir, passe --confirm=${CONFIRMATION_WORD}.`);
}

const storage = createBackupStorage({
  baseUrl: storageUrl as string,
  token: storageToken as string,
  bucket,
});

say('Restaurando (tudo ou nada), com backup de segurança antes…');
const now = new Date();
const result = await performRestore({
  name: name as string,
  identity: await readFile(identity as string, 'utf8'),
  connection: environment.database.connection,
  currentSchema: current,
  recipient: publicKey as string,
  storage,
  today: now.toISOString().slice(0, 10),
  clockTime: now.toISOString().slice(11, 16),
});
say(`Backup de segurança: ${result.safety}`);
say(
  'Restauração concluída. Suba o app, rode a sincronização de mercado e a suíte de consistência.',
);
