import type { IndexProvider, QuoteSource, TreasurySource } from '@patrimonio/application';
import { environment } from '@patrimonio/env';
import {
  BOLSAI_SHAPE,
  BOLSAI_SOURCE,
  createBcbProvider,
  createBrapiProvider,
  createJsonQuoteProvider,
  createQuoteChain,
  createTesouroCsvProvider,
  createTesouroJsonProvider,
  createTreasuryChain,
  createHttpClient,
  sleep,
  withRetry,
} from '@patrimonio/market';
import type { HttpClient } from '@patrimonio/market';

/**
 * A montagem das fontes. É o único arquivo do worker que conhece o nome de um
 * provedor: os casos de uso recebem a cadeia pronta, e trocar a fonte principal
 * é mudar a ordem aqui — ou a variável de ambiente que a define.
 *
 * Três tentativas com backoff antes de passar para o elo seguinte. O `fetch`
 * global entra por injeção no cliente, que é o que permite ao teste responder
 * com arquivo gravado sem tocar a rede.
 */
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
};

export const createMarketSources = (): MarketSources => {
  const brapi = createBrapiProvider({
    // O 404 da brapi é resposta sobre o papel — "não conheço esse ticker" — e
    // não falha da coleta. Ele é lido, e o papel entra em `missing`.
    http: clientFor('brapi', [404]),
    ...(environment.market.brapiToken === undefined
      ? {}
      : { token: environment.market.brapiToken }),
    // Um por requisição no plano gratuito. Num plano pago, só este número muda.
    tickersPerRequest: 1,
  });

  const alternativo = createJsonQuoteProvider({
    id: BOLSAI_SOURCE,
    http: clientFor(BOLSAI_SOURCE, [404]),
    shape: BOLSAI_SHAPE,
    url: (tickers) =>
      `https://api.usebolsai.com/v1/quotes?tickers=${tickers.join(',')}`,
    historyUrl: (ticker, from, to) =>
      `https://api.usebolsai.com/v1/history?ticker=${ticker}&from=${from}&to=${to}`,
  });

  return {
    // A ordem é a da configuração: principal primeiro, alternativa depois, e o
    // `source_kind` do preço gravado sai da posição.
    quotes: createQuoteChain([brapi, alternativo]),
    indices: createBcbProvider({ http: clientFor('bcb') }),
    treasury: createTreasuryChain([
      createTesouroJsonProvider({ http: clientFor('tesouro-direto') }),
      createTesouroCsvProvider({ http: clientFor('tesouro-transparente') }),
    ]),
  };
};
