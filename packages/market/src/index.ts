/**
 * Os provedores de cotação, índice e Tesouro, atrás das interfaces declaradas
 * em `application/interfaces`. Nenhum código fora deste pacote conhece o nome
 * de um provedor: trocar de fonte é mudar variável de ambiente.
 *
 * Cada provedor é testado contra respostas HTTP gravadas em arquivo, com os
 * sete casos de mudança de formato, mais um teste por provedor que fala com a
 * API real e roda só na verificação noturna.
 */
export {
  PRICE_INDEX_LOOKBACK_DAYS,
  createIndexProviderSet,
  createPriceIndexProvider,
} from './providers/price_index.provider.js';
export type { PriceIndexSymbols } from './providers/price_index.provider.js';
export { createQuoteChain, createTreasuryChain } from './chain.js';

export {
  BCB_SOURCE,
  SGS_SERIES,
  createBcbProvider,
  sgsUrl,
} from './providers/bcb.provider.js';
export {
  BRAPI_FREE_MONTHLY_CEILING,
  BRAPI_SOURCE,
  chunk,
  createBrapiProvider,
  quoteUrl,
} from './providers/brapi.provider.js';
export { COTAHIST_SOURCE, readCotahist, readLines } from './cotahist/reader.js';
export type { CotahistReport, ReadOptions } from './cotahist/reader.js';
export { RECORD_LENGTH, parseInstrumentRecord, parseRecord } from './cotahist/layout.js';
export type { CotahistInstrumentRecord, CotahistRecord } from './cotahist/layout.js';
export { readCotahistInstruments } from './cotahist/instruments.js';
export type { CotahistInstrument, CotahistInstruments } from './cotahist/instruments.js';
export {
  TESOURO_CSV_SOURCE,
  TESOURO_CSV_URL,
  createTesouroCsvProvider,
  kindFromName,
} from './providers/tesouro.provider.js';

export { createHttpClient, excerpt, sleep, withRetry } from './http/client.js';
export type {
  ClientOptions,
  FetchLike,
  HttpClient,
  HttpRequest,
  HttpResponse,
  RetryOptions,
} from './http/client.js';

export {
  asArray,
  asJson,
  asObject,
  at,
  dateField,
  decimalField,
  formatChanged,
  optionalDateField,
  parsing,
  stringField,
} from './support/format.js';

export { formatChanges, probeSources, reportOf } from './verify/probes.js';
export type { ProbeOptions, ProbeOutcome, ProbeResult } from './verify/probes.js';
