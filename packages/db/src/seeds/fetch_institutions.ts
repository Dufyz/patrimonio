import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  mergeInstitutionNames,
  parseCvmIntermediaries,
  parseStrParticipants,
} from './institutions.js';

const STR_URL =
  'https://www.bcb.gov.br/content/estabilidadefinanceira/str1/ParticipantesSTR.csv';
const CVM_URL = 'https://dados.cvm.gov.br/dados/INTERMED/CAD/DADOS/cad_intermed.zip';

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

export type InstitutionSources = { readonly str?: string; readonly cvm?: string };

/** Baixa (ou lê de arquivo) STR e CVM e devolve os nomes únicos, já mesclados. */
export const fetchInstitutionNames = async (
  sources: InstitutionSources = {},
): Promise<{
  readonly names: readonly string[];
  readonly str: number;
  readonly cvm: number;
}> => {
  const str = parseStrParticipants(await read(sources.str ?? STR_URL));
  const cvm = parseCvmIntermediaries(await read(sources.cvm ?? CVM_URL));

  return { names: mergeInstitutionNames(str, cvm), str: str.length, cvm: cvm.length };
};
