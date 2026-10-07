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

export { BCB_SOURCE, SGS_SERIES, createBcbProvider, sgsUrl } from './providers/bcb.provider.js';
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
