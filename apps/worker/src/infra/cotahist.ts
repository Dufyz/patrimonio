import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { MarketDataUnavailableError } from '@patrimonio/application';
import type { InstrumentCatalogSource } from '@patrimonio/application';
import { COTAHIST_SOURCE, readCotahistInstruments, readLines } from '@patrimonio/market';
import { failure, success } from '@patrimonio/shared';

/**
 * O arquivo anual do COTAHIST, no endereço público da B3. Oficial, sem chave e
 * sem cota: é por isso que o catálogo vem dele e não de uma API.
 */
export const cotahistAnnualUrl = (year: number): string =>
  `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A${year}.ZIP`;

const isUrl = (location: string): boolean => /^https?:\/\//u.test(location);

class NotFound extends Error {}

const isZip = async (path: string): Promise<boolean> => {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(4);
    await handle.read(buffer, 0, 4, 0);
    return (
      buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
    );
  } finally {
    await handle.close();
  }
};

/** Extrai o primeiro arquivo do ZIP para outro arquivo, sem passar pela memória. */
const unzip = async (zip: string, target: string): Promise<void> => {
  const child = spawn('unzip', ['-p', zip], { stdio: ['ignore', 'pipe', 'pipe'] });

  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', (error) =>
      reject(new Error(`não foi possível executar o unzip: ${error.message}`)),
    );
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`unzip terminou com código ${code}`)),
    );
  });

  await Promise.all([pipeline(child.stdout, createWriteStream(target)), exited]);
};

const download = async (url: string, target: string): Promise<void> => {
  const response = await globalThis.fetch(url);

  if (response.status === 404) throw new NotFound(url);
  if (!response.ok || response.body === null) {
    throw new Error(`${url} respondeu ${response.status}`);
  }

  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));
};

/**
 * O texto do arquivo em disco: baixado quando o endereço é HTTP, extraído quando
 * é ZIP. O diretório temporário some no fim, com o arquivo de algumas centenas
 * de megabytes dentro.
 */
const withCotahistFile = async <T>(
  location: string,
  use: (path: string) => Promise<T>,
): Promise<T> => {
  const directory = await mkdtemp(join(tmpdir(), 'patrimonio-cotahist-'));

  try {
    let path = location;

    if (isUrl(location)) {
      path = join(directory, 'baixado');
      await download(location, path);
    }

    if (await isZip(path)) {
      const extracted = join(directory, 'COTAHIST.TXT');
      await unzip(path, extracted);
      path = extracted;
    }

    return await use(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

export type InstrumentCatalogOptions = {
  /** O ano do arquivo a ler; no começo de janeiro o anterior serve de reserva. */
  readonly year: () => number;
  /** Um caminho ou endereço que substitui o da B3: `--arquivo=` do comando. */
  readonly location?: string | undefined;
};

export const createInstrumentCatalogSource = (
  options: InstrumentCatalogOptions,
): InstrumentCatalogSource => ({
  fetchInstruments: async () => {
    const year = options.year();
    const candidates =
      options.location === undefined
        ? [cotahistAnnualUrl(year), cotahistAnnualUrl(year - 1)]
        : [options.location];

    for (const candidate of candidates) {
      try {
        const read = await withCotahistFile(candidate, (path) =>
          readCotahistInstruments(readLines(path)),
        );

        if (read.isFailure()) return failure(read.value);

        return success({
          instruments: read.value.instruments,
          source: COTAHIST_SOURCE,
          last_date: read.value.last_date,
          lines_read: read.value.lines_read,
        });
      } catch (error) {
        if (error instanceof NotFound) continue;

        return failure(
          new MarketDataUnavailableError(
            `${COTAHIST_SOURCE}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }

    return failure(
      new MarketDataUnavailableError(
        `${COTAHIST_SOURCE}: o arquivo de ${year} não está publicado (HTTP 404)`,
      ),
    );
  },
});
