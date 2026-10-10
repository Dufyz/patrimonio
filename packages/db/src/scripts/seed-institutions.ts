import { readFile } from 'node:fs/promises';

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
  'https://www.bcb.gov.br/content/estabilidadefinanceira/spb_str1/ParticipantesSTR.csv';
const CVM_URL = 'https://dados.cvm.gov.br/dados/INTERMED/CAD/DADOS/cad_intermed.csv';

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

const read = async (source: string): Promise<string> => {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`${source} respondeu ${response.status}`);
    return decode(new Uint8Array(await response.arrayBuffer()));
  }

  return decode(new Uint8Array(await readFile(source)));
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
