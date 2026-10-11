import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { environment } from '@patrimonio/env';

import { createConnection, closeDatabase } from '../postgresql.js';
import {
  mergeInstitutionNames,
  parseCvmIntermediaries,
  parseStrParticipants,
} from '../seeds/institutions.js';
import { loadInstitutions } from '../seeds/load_institutions.js';

/**
 * `pnpm seed:institutions [--test] [--str=<arquivo|url>] [--cvm=<arquivo|url>]`
 *
 * Carrega as instituições brasileiras: os participantes do STR (Banco Central) e
 * os intermediários da CVM. Sem argumentos, baixa os dois arquivos oficiais.
 * Idempotente: quem já existe fica como está.
 */
const STR_URL =
  'https://www.bcb.gov.br/content/estabilidadefinanceira/str1/ParticipantesSTR.csv';
const CVM_URL = 'https://dados.cvm.gov.br/dados/INTERMED/CAD/DADOS/cad_intermed.zip';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);

const decode = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
};

const run = promisify(execFile);

const isZip = (bytes: Uint8Array): boolean =>
  bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** A CVM publica o cadastro em .zip: extrai o CSV com o `unzip` do sistema. */
const unzip = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const directory = await mkdtemp(join(tmpdir(), 'patrimonio-seed-'));
  try {
    const file = join(directory, 'arquivo.zip');
    await writeFile(file, bytes);
    const { stdout } = await run('unzip', ['-p', file, '*.csv'], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    return new Uint8Array(stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const read = async (source: string): Promise<string> => {
  const bytes =
    /^https?:\/\//.test(source)
      ? await (async () => {
          const response = await fetch(source);
          if (!response.ok) throw new Error(`${source} respondeu ${response.status}`);
          return new Uint8Array(await response.arrayBuffer());
        })()
      : new Uint8Array(await readFile(source));

  return decode(isZip(bytes) ? await unzip(bytes) : bytes);
};

const useTest = argv.includes('--test');
const connection = useTest
  ? environment.database.testConnection
  : environment.database.connection;

if (connection === undefined) {
  process.stderr.write('DB_TEST_CONNECTION não está definida\n');
  process.exit(1);
}

const sql = createConnection({
  connection,
  poolSize: 1,
  applicationName: 'patrimonio-seed',
});

try {
  const str = parseStrParticipants(await read(flag('str') ?? STR_URL));
  const cvm = parseCvmIntermediaries(await read(flag('cvm') ?? CVM_URL));
  const names = mergeInstitutionNames(str, cvm);

  const { inserted, received } = await loadInstitutions(sql, names);

  process.stdout.write(
    `instituições: ${str.length} do STR, ${cvm.length} da CVM, ${received} únicas, ${inserted} novas\n`,
  );
} finally {
  await closeDatabase(sql);
}
