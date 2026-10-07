import type {
  AppError,
  ClosingResult,
  PriceQuote,
  QuoteProvider,
} from '@patrimonio/application';
import type { B3Type, DateOnly } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { HttpClient } from '../http/client.js';
import {
  asArray,
  asJson,
  asObject,
  at,
  dateField,
  decimalField,
  stringField,
  parsing,
} from '../support/format.js';

/**
 * O provedor de cotação **declarado por configuração**: o endereço e os
 * caminhos dos campos entram como dados, não como código.
 *
 * Ele existe porque um dia sem fechamento contamina o patrimônio daquele dia, e
 * a alternativa precisa assumir sem intervenção. Mas a alternativa é um projeto
 * novo, de autor individual, sem histórico de disponibilidade — e é exatamente o
 * tipo de fonte cujo contrato muda. Escrever um parser dedicado para ela seria
 * assumir uma forma que não dá para garantir hoje; declará-la como dados torna
 * a correção uma linha de configuração, e não um deploy de código.
 *
 * O que confere se a configuração ainda vale é a verificação noturna: ela fala
 * com a API real, e formato alterado abre issue com o trecho recebido antes de o
 * número aparecer na tela.
 *
 * ## A forma declarada
 *
 * ```ts
 * {
 *   list: ['data'],            // onde está a lista de papéis
 *   ticker: 'symbol',
 *   close: 'close',
 *   date: 'date',              // opcional: sem ele, vale a data pedida
 * }
 * ```
 */
export type QuoteShape = {
  /** O caminho até a lista, degrau por degrau. Lista na raiz é `[]`. */
  readonly list: readonly string[];
  readonly ticker: string;
  readonly close: string;
  readonly date?: string | undefined;
};

export type JsonQuoteOptions = {
  readonly id: string;
  readonly http: HttpClient;
  readonly supports?: readonly B3Type[] | undefined;
  readonly shape: QuoteShape;
  /** O endereço da consulta, montado com os papéis pedidos. */
  readonly url: (tickers: readonly string[], date: DateOnly) => string;
  readonly tickersPerRequest?: number | undefined;
  /** O endereço da série histórica, quando a fonte serve uma. */
  readonly historyUrl?:
    | ((ticker: string, from: DateOnly, to: DateOnly) => string)
    | undefined;
};

const DEFAULT_SUPPORTED: readonly B3Type[] = ['stock', 'fii', 'etf', 'bdr'];

const chunk = <T>(items: readonly T[], size: number): readonly (readonly T[])[] => {
  const groups: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }

  return groups;
};

export const createJsonQuoteProvider = (
  options: JsonQuoteOptions,
): QuoteProvider => {
  const perRequest = Math.max(1, options.tickersPerRequest ?? 10);

  const read = (
    body: string,
    asked: readonly string[],
    date: DateOnly,
  ): Either<AppError, ClosingResult> =>
    parsing(options.id, () => {
      const envelope = asObject(asJson(body, 'body'), 'body');
      const where = options.shape.list.join('.') || 'body';
      const rows = asArray(
        options.shape.list.length === 0 ? envelope : at(envelope, options.shape.list),
        where,
      );

      const quotes: PriceQuote[] = [];
      const found = new Set<string>();

      for (const [index, item] of rows.entries()) {
        const path = `${where}[${index}]`;
        const row = asObject(item, path);

        const ticker = stringField(
          row,
          options.shape.ticker,
          `${path}.${options.shape.ticker}`,
        ).toUpperCase();

        if (row[options.shape.close] === null || row[options.shape.close] === undefined) {
          continue;
        }

        found.add(ticker);
        quotes.push({
          ticker,
          price_date:
            options.shape.date === undefined
              ? date
              : dateField(row, options.shape.date, `${path}.${options.shape.date}`),
          close: decimalField(
            row,
            options.shape.close,
            `${path}.${options.shape.close}`,
          ),
        });
      }

      return {
        quotes,
        missing: asked.filter((candidate) => !found.has(candidate.toUpperCase())),
      };
    });

  return {
    id: options.id,
    supports: options.supports ?? DEFAULT_SUPPORTED,

    requestsIn: (tickers) => chunk(tickers, perRequest).length,

    fetchClosing: async (tickers, date) => {
      const quotes: PriceQuote[] = [];
      const missing: string[] = [];

      for (const batch of chunk(tickers, perRequest)) {
        const response = await options.http({ url: options.url(batch, date) });
        if (response.isFailure()) return response;

        const parsed = read(response.value.body, batch, date);
        if (parsed.isFailure()) return parsed;

        quotes.push(...parsed.value.quotes);
        missing.push(...parsed.value.missing);
      }

      return success({ quotes, missing });
    },

    ...(options.historyUrl === undefined
      ? {}
      : {
          fetchHistory: async (ticker: string, from: DateOnly, to: DateOnly) => {
            const response = await options.http({
              url: options.historyUrl?.(ticker, from, to) ?? '',
            });
            if (response.isFailure()) return response;

            const parsed = read(response.value.body, [ticker], to);
            if (parsed.isFailure()) return parsed;

            // A série vem inteira e o intervalo é recortado aqui: a fonte pode
            // devolver mais dias do que foram pedidos.
            const quotes = parsed.value.quotes.filter(
              (quote) => quote.price_date >= from && quote.price_date <= to,
            );

            return success({
              quotes,
              missing: quotes.length === 0 ? [ticker] : [],
            });
          },
        }),
  };
};

/**
 * A configuração do provedor alternativo. OHLCV desde 1986, proventos e macro,
 * 200 requisições por dia no gratuito.
 *
 * **Os nomes dos campos aqui precisam ser conferidos contra a documentação da
 * fonte antes do primeiro uso em produção.** Eles são a forma mais comum de uma
 * API de cotação e não uma leitura da documentação dela, que não estava
 * acessível quando isto foi escrito. É para exatamente este risco que a
 * verificação noturna existe: ela fala com a API real e falha nomeando o campo,
 * sem bloquear commit nem deploy.
 */
export const BOLSAI_SHAPE: QuoteShape = {
  list: ['data'],
  ticker: 'ticker',
  close: 'close',
  date: 'date',
};

export const BOLSAI_SOURCE = 'usebolsai';

export const BOLSAI_DAILY_CEILING = 200;
