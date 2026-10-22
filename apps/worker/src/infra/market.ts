import type {
  IndexProvider,
  InstrumentCatalogSource,
  PriceHistorySource,
  QuoteSource,
  TreasurySource,
} from '@patrimonio/application';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { environment } from '@patrimonio/env';
import {
  createBcbProvider,
  createBrapiProvider,
  createQuoteChain,
  createTesouroCsvProvider,
  createTreasuryChain,
  createHttpClient,
  createIndexProviderSet,
  createPriceIndexProvider,
  sleep,
  withRetry,
} from '@patrimonio/market';
import type { HttpClient } from '@patrimonio/market';

import {
  createCotahistQuoteSource,
  createInstrumentCatalogSource,
  createPriceHistorySource,
} from './cotahist.js';

/**
 * A montagem das fontes. É o único arquivo do worker que conhece o nome de um
 * provedor: os casos de uso recebem a cadeia pronta, e trocar a fonte principal
 * é mudar a ordem aqui — ou a variável de ambiente que a define.
 *
 * Três tentativas com backoff antes de passar para o elo seguinte. O `fetch`
 * global entra por injeção no cliente, que é o que permite ao teste responder
 * com arquivo gravado sem tocar a rede.
 */
const PRICE_INDEX_SYMBOLS = { IBOV: '^BVSP', IFIX: 'IFIX.SA' } as const;

const RETRY = { attempts: 3, backoffMs: 500, sleep } as const;

const clientFor = (source: string, passthrough: readonly number[] = []): HttpClient =>
  withRetry(
    createHttpClient({
      fetch: (url, init) => globalThis.fetch(url, init),
      timeoutMs: environment.market.requestTimeoutMs,
      source,
      ...(passthrough.length === 0 ? {} : { passthroughStatuses: passthrough }),
    }),
    RETRY,
  );

export type MarketSources = {
  readonly quotes: QuoteSource;
  readonly indices: IndexProvider;
  readonly treasury: TreasurySource;
  readonly instruments: InstrumentCatalogSource;
  readonly history: PriceHistorySource;
};

export const createMarketSources = (options: {
  readonly year: () => number;
}): MarketSources => {
  // A brapi serve só os índices de pontos (IBOV e IFIX), que o COTAHIST não tem.
  // O 404 dela é resposta sobre o símbolo — "não conheço" — e não falha da coleta.
  const brapi = createBrapiProvider({
    http: clientFor('brapi', [404]),
    ...(environment.market.brapiToken === undefined
      ? {}
      : { token: environment.market.brapiToken }),
    // Um por requisição no plano gratuito.
    tickersPerRequest: 1,
  });

  const indexQuotes = createQuoteChain([brapi]);
  const history = createPriceHistorySource({ currentYear: options.year });

  return {
    // O preço de papel de bolsa é o fechamento oficial da B3 (COTAHIST), sempre
    // do pregão anterior: o arquivo do dia sai à noite, e a coleta roda de manhã.
    quotes: createCotahistQuoteSource({ history }),
    // CDI, Selic e IPCA vêm do Banco Central; IBOV e IFIX, da brapi.
    indices: createIndexProviderSet('indices', [
      createBcbProvider({ http: clientFor('bcb') }),
      createPriceIndexProvider({
        id: 'cotacoes',
        quotes: indexQuotes,
        symbols: PRICE_INDEX_SYMBOLS,
      }),
    ]),
    // O Tesouro Transparente recusa por volume: sem repetição automática (cada
    // tentativa conta no limite), com arquivo guardado em disco entre execuções.
    treasury: createTreasuryChain([
      createTesouroCsvProvider({
        http: createHttpClient({
          fetch: (url, init) => globalThis.fetch(url, init),
          timeoutMs: environment.market.requestTimeoutMs * 6,
          source: 'tesouro-transparente',
        }),
        cacheDir: join(tmpdir(), 'patrimonio-cache'),
      }),
    ]),
    instruments: createInstrumentCatalogSource({ year: options.year }),
    history,
  };
};
