import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { MarketDataUnavailableError } from '@patrimonio/application';
import type {
  AppError,
  HistoricalPrices,
  InstrumentCatalogSource,
  PriceHistorySource,
  PriceQuote,
  QuoteSource,
} from '@patrimonio/application';
import {
  COTAHIST_SOURCE,
  readCotahist,
  readCotahistInstruments,
  readLines,
} from '@patrimonio/market';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

/**
 * O arquivo anual do COTAHIST, no endereço público da B3. Oficial, sem chave e
 * sem cota: é por isso que o catálogo vem dele e não de uma API.
 */
export const cotahistAnnualUrl = (year: number): string =>
  `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A${year}.ZIP`;

/**
 * O arquivo diário do COTAHIST (`COTAHIST_DDMMAAAA.ZIP`): só o pregão do dia,
 * publicado pela B3 por volta das 21:35. É pequeno, então a coleta do D-1 baixa
 * ele e não o arquivo anual, que tem centenas de megabytes.
 */
export const cotahistDailyUrl = (date: string): string => {
  const [year, month, day] = date.split('-');

  return `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D${day}${month}${year}.ZIP`;
};

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

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export const DEFAULT_CACHE_DIRECTORY = join(tmpdir(), 'patrimonio-cotahist-cache');

export type PriceHistoryOptions = {
  /** Onde ficam os arquivos dos anos fechados, já extraídos. */
  readonly cacheDirectory?: string | undefined;
  /** Um caminho ou endereço que substitui o da B3, por ano. */
  readonly locationFor?: ((year: number) => string | undefined) | undefined;
  /** O ano corrente: o arquivo dele muda todo dia e nunca vai para o cache. */
  readonly currentYear: () => number;
};

/**
 * O arquivo extraído de um ano. Ano fechado não muda, e o arquivo de uma centena
 * de megabytes baixado a cada backfill seria o custo de um lançamento retroativo:
 * ele fica em disco e a leitura seguinte o reaproveita.
 */
const withYearFile = async <T>(
  year: number,
  options: PriceHistoryOptions,
  use: (path: string) => Promise<T>,
): Promise<T> => {
  const override = options.locationFor?.(year);
  if (override !== undefined) return withCotahistFile(override, use);

  const cacheable = year < options.currentYear();
  if (!cacheable) return withCotahistFile(cotahistAnnualUrl(year), use);

  const directory = options.cacheDirectory ?? DEFAULT_CACHE_DIRECTORY;
  const cached = join(directory, `COTAHIST_A${year}.TXT`);

  if (!(await exists(cached))) {
    await mkdir(directory, { recursive: true });
    const partial = `${cached}.${process.pid}.parcial`;

    await withCotahistFile(cotahistAnnualUrl(year), (path) => copyFile(path, partial));
    await rename(partial, cached);
  }

  return use(cached);
};

/**
 * O histórico de fechamentos dos arquivos anuais. Ano ainda não publicado entra
 * em `unavailable_years` e não derruba a leitura: o que vem dos outros anos vale.
 */
export const createPriceHistorySource = (
  options: PriceHistoryOptions,
): PriceHistorySource => ({
  fetchRange: async (
    tickers: readonly string[],
    from: string,
    to: string,
  ): Promise<Either<AppError, HistoricalPrices>> => {
    const firstYear = Number(from.slice(0, 4));
    const lastYear = Number(to.slice(0, 4));

    const quotes: PriceQuote[] = [];
    const found = new Set<string>();
    const unavailable: number[] = [];
    let linesRead = 0;
    let recordsKept = 0;

    for (let year = firstYear; year <= lastYear; year += 1) {
      try {
        const report = await withYearFile(year, options, (path) =>
          readCotahist(readLines(path), { tickers, from, to }),
        );

        if (report.isFailure()) return failure(report.value);

        for (const quote of report.value.quotes) {
          quotes.push(quote);
          found.add(quote.ticker);
        }
        linesRead += report.value.lines_read;
        recordsKept += report.value.records_kept;
      } catch (error) {
        if (error instanceof NotFound) {
          unavailable.push(year);
          continue;
        }

        return failure(
          new MarketDataUnavailableError(
            `${COTAHIST_SOURCE}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }

    return success({
      quotes,
      source: COTAHIST_SOURCE,
      lines_read: linesRead,
      records_kept: recordsKept,
      missing: tickers.filter((ticker) => !found.has(ticker.toUpperCase())),
      unavailable_years: unavailable,
    });
  },
});

export type CotahistQuoteOptions = {
  /** O histórico por intervalo, para o backfill: os arquivos anuais. */
  readonly history: PriceHistorySource;
  /** Um caminho ou endereço que substitui o da B3, por data: usado em teste. */
  readonly locationFor?: ((date: string) => string | undefined) | undefined;
};

/**
 * A única fonte de preço de papel de bolsa: o fechamento oficial da B3.
 *
 * - **O dia** vem do arquivo diário. Arquivo ausente (404) é "ainda não foi
 *   publicado", uma indisponibilidade transitória: o estágio tenta de novo, e
 *   nada é gravado enquanto isso — ausência nunca vira zero.
 * - **O histórico** vem dos arquivos anuais, os mesmos do catálogo e da carga
 *   inicial.
 *
 * Preço de outro dia que apareça no arquivo é descartado: o arquivo diário só
 * tem o pregão dele, e um preço com data errada entraria na série parecendo certo.
 */
export const createCotahistQuoteSource = (options: CotahistQuoteOptions): QuoteSource => ({
  fetchClosing: async (tickers, date) => {
    const location = options.locationFor?.(date) ?? cotahistDailyUrl(date);

    try {
      const report = await withCotahistFile(location, (path) =>
        readCotahist(readLines(path), { tickers, from: date, to: date }),
      );

      if (report.isFailure()) return failure(report.value);

      const quotes = report.value.quotes.filter((quote) => quote.price_date === date);
      const found = new Set(quotes.map((quote) => quote.ticker.toUpperCase()));

      return success({
        quotes,
        missing: tickers.filter((ticker) => !found.has(ticker.toUpperCase())),
        source: COTAHIST_SOURCE,
        source_kind: 'primary' as const,
        requests: 1,
      });
    } catch (error) {
      const reason =
        error instanceof NotFound
          ? `o arquivo de ${date} ainda não foi publicado (HTTP 404)`
          : error instanceof Error
            ? error.message
            : String(error);

      return failure(new MarketDataUnavailableError(`${COTAHIST_SOURCE}: ${reason}`));
    }
  },

  fetchHistory: async (ticker, from, to) => {
    const read = await options.history.fetchRange([ticker], from, to);
    if (read.isFailure()) return failure(read.value);

    return success({
      quotes: read.value.quotes,
      missing: read.value.missing,
      source: COTAHIST_SOURCE,
      source_kind: 'primary' as const,
      requests: 0,
    });
  },
});
