import {
  MarketDataUnavailableError,
  MarketSourceRejectedError,
} from '@patrimonio/application';
import type { AppError } from '@patrimonio/application';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

/**
 * O único lugar do pacote que fala HTTP. `fetch` entra por parâmetro: em teste
 * ele é uma função que devolve resposta gravada em arquivo, e nenhum teste de
 * commit toca a rede.
 *
 * A classificação do erro é a parte que importa. 5xx, 429 e falha de rede são
 * transitórias — o `defineStage` reexecuta com backoff. 4xx é definitiva:
 * insistir contra um 404 não traz o preço, só queima cota.
 */
export type HttpRequest = {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
};

export type HttpResponse = {
  readonly status: number;
  readonly body: string;
};

export type HttpClient = (request: HttpRequest) => Promise<Either<AppError, HttpResponse>>;

/** Quanto do corpo entra no erro. Suficiente para diagnosticar, curto para logar. */
export const EXCERPT_LIMIT = 500;

export const excerpt = (body: string): string =>
  body.length <= EXCERPT_LIMIT ? body : `${body.slice(0, EXCERPT_LIMIT)}…`;

export type FetchLike = (
  url: string,
  init: { readonly headers?: Record<string, string>; readonly signal: AbortSignal },
) => Promise<{ readonly status: number; readonly text: () => Promise<string> }>;

export type ClientOptions = {
  readonly fetch: FetchLike;
  readonly timeoutMs: number;
  /** A fonte, para o erro dizer quem não respondeu. */
  readonly source: string;
};

export const createHttpClient = (options: ClientOptions): HttpClient => {
  return async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await options.fetch(request.url, {
        ...(request.headers === undefined ? {} : { headers: { ...request.headers } }),
        signal: controller.signal,
      });

      const body = await response.text();

      // 429 é transitório por definição: o limite é por janela de tempo, e
      // esperar resolve. Virar erro definitivo aqui perderia o dia inteiro.
      if (response.status === 429) {
        return failure(
          new MarketDataUnavailableError(
            `${options.source} recusou por limite de requisições`,
          ),
        );
      }

      if (response.status >= 500) {
        return failure(
          new MarketDataUnavailableError(
            `${options.source} respondeu ${response.status}`,
          ),
        );
      }

      // Outro 4xx é definitivo: chave inválida, endpoint que mudou, cota do
      // mês esgotada. Repetir queima o que sobrou da cota sem trazer preço.
      if (response.status >= 400) {
        return failure(
          new MarketSourceRejectedError(
            `${options.source} respondeu ${response.status}: ${excerpt(body)}`,
          ),
        );
      }

      return success({ status: response.status, body });
    } catch (error) {
      // Timeout e falha de rede são a mesma coisa para quem espera o preço: a
      // fonte não respondeu, e vale tentar de novo.
      const reason = error instanceof Error ? error.message : String(error);

      return failure(
        new MarketDataUnavailableError(`${options.source} não respondeu: ${reason}`),
      );
    } finally {
      clearTimeout(timer);
    }
  };
};

export type RetryOptions = {
  readonly attempts: number;
  readonly backoffMs: number;
  /** Injetado para o teste não esperar de verdade. */
  readonly sleep: (ms: number) => Promise<void>;
};

/**
 * Três tentativas com backoff, e depois passa para o próximo elo da cadeia.
 * Só erro transitório é repetido: 4xx volta na primeira tentativa, porque
 * repetir não muda a resposta.
 */
export const withRetry = (client: HttpClient, options: RetryOptions): HttpClient => {
  return async (request) => {
    let last = await client(request);

    for (let attempt = 1; attempt < options.attempts; attempt += 1) {
      if (last.isSuccess()) return last;
      if (!last.value.isTransient) return last;

      await options.sleep(options.backoffMs * 2 ** (attempt - 1));
      last = await client(request);
    }

    return last;
  };
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
