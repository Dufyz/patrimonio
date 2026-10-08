/**
 * Os provedores de cotação, índice e Tesouro, atrás das interfaces declaradas
 * em `application/interfaces`. Nenhum código fora deste pacote conhece o nome
 * de um provedor: trocar de fonte é mudar variável de ambiente.
 *
 * Cada provedor é testado contra respostas HTTP gravadas em arquivo, com os
 * sete casos de mudança de formato, mais um teste por provedor que fala com a
 * API real e roda só na verificação noturna.
 */
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
export {
  BOLSAI_DAILY_CEILING,
  BOLSAI_SHAPE,
  BOLSAI_SOURCE,
  createJsonQuoteProvider,
} from './providers/json_quote.provider.js';
export type { JsonQuoteOptions, QuoteShape } from './providers/json_quote.provider.js';
export { COTAHIST_SOURCE, readCotahist, readLines } from './cotahist/reader.js';
export type { CotahistReport, ReadOptions } from './cotahist/reader.js';
export { RECORD_LENGTH, parseRecord } from './cotahist/layout.js';
export type { CotahistRecord } from './cotahist/layout.js';
export { WARNING_RATIO, budgetFor, monthlyProjection } from './usage.js';
export type { Budget } from './usage.js';
export {
  TESOURO_CSV_SOURCE,
  TESOURO_CSV_URL,
  TESOURO_JSON_SOURCE,
  TESOURO_JSON_URL,
  createTesouroCsvProvider,
  createTesouroJsonProvider,
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
