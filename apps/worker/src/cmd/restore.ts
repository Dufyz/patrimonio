import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrationStatus } from '@patrimonio/db';
import { environment } from '@patrimonio/env';

import { backupFileName, createEncryptedDump } from '../infra/backup/dump.js';
import {
  checkRestorable,
  confirmed,
  CONFIRMATION_WORD,
  parseBackupName,
  restoreEncryptedDump,
} from '../infra/backup/restore.js';
import { createBackupStorage } from '../infra/backup/storage.js';

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

say('Gravando backup de segurança do estado atual…');
const today = new Date().toISOString().slice(0, 10);
const safety = await createEncryptedDump({
  connection: environment.database.connection,
  recipient: publicKey as string,
  date: today,
});
const safetyName = backupFileName(today, {
  schema: current,
  manualAt: `pre${new Date().toISOString().slice(11, 16).replace(':', '')}`.replace(
    /[^0-9]/g,
    '',
  ),
});
await storage.upload(safetyName, safety.path);
await safety.cleanup();
say(`Backup de segurança: ${safetyName}`);

const local = join(tmpdir(), `restore-${name}`);
await storage.download(name as string, local);
say('Restaurando (tudo ou nada)…');
await restoreEncryptedDump({
  connection: environment.database.connection,
  file: local,
  identityPath: identity as string,
});
say(
  'Restauração concluída. Suba o app, rode a sincronização de mercado e a suíte de consistência.',
);
