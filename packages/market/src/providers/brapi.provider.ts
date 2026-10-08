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
 * A brapi é a fonte de fechamento do dia em renda variável. A escolha não foi
 * por cobertura — todo provedor cobre a B3 — e sim por confiabilidade de
 * contrato: documentação versionada, `v2` separado do `v1`, página de status e
 * termos públicos. Uma fonte que muda o formato sem avisar vira manutenção toda
 * semana.
 *
 * ## O que o plano gratuito impõe
 *
 * Um ticker por requisição e uma requisição simultânea. Trinta ativos são
 * trinta chamadas sequenciais, uns dez segundos num job noturno — irrelevante.
 * O que importa é o teto mensal de quinze mil: com trinta ativos o consumo fica
 * perto de mil por mês, e `requestsIn` existe para esse número ser registrado e
 * comparado ao teto antes de ele estourar, não depois.
 *
 * Num plano pago o lote cresce, e `tickersPerRequest` é a única coisa que muda.
 *
 * ## Ticker inexistente
 *
 * A brapi responde 404 para um papel que ela não conhece. Isso é informação
 * sobre aquele papel, não falha da coleta: o 404 é lido como resposta e o
 * ticker entra em `missing`. Tratá-lo como erro jogaria fora as outras
 * cotações da chamada e abriria retry contra uma resposta que não vai mudar.
 */
export const BRAPI_SOURCE = 'brapi';

export const BRAPI_FREE_MONTHLY_CEILING = 15_000;

const SUPPORTED: readonly B3Type[] = ['stock', 'fii', 'etf', 'bdr'];

export type BrapiOptions = {
  readonly http: HttpClient;
  readonly token?: string | undefined;
  /** Um no plano gratuito; dez ou mais nos pagos. */
  readonly tickersPerRequest?: number | undefined;
  readonly baseUrl?: string | undefined;
};

export const chunk = <T>(
  items: readonly T[],
  size: number,
): readonly (readonly T[])[] => {
  const groups: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }

  return groups;
};

export const quoteUrl = (
  tickers: readonly string[],
  options: BrapiOptions,
  extra: Readonly<Record<string, string>> = {},
): string => {
  const base = options.baseUrl ?? 'https://brapi.dev/api';
  const query = new URLSearchParams(extra);

  if (options.token !== undefined && options.token !== '') {
    query.set('token', options.token);
  }

  const suffix = query.toString();

  return `${base}/quote/${tickers.join(',')}${suffix === '' ? '' : `?${suffix}`}`;
};

/**
 * `regularMarketPrice` é o preço do último negócio. Lido depois do fechamento —
 * que é quando o job roda, às 18:30 — ele **é** o fechamento do dia. Rodar este
 * provedor no meio do pregão gravaria preço intradiário como fechamento, e é por
 * isso que a agenda do estágio não é detalhe de operação: é parte da correção.
 */
const CLOSE_FIELD = 'regularMarketPrice';
const TIME_FIELD = 'regularMarketTime';

export const createBrapiProvider = (options: BrapiOptions): QuoteProvider => {
  const perRequest = Math.max(1, options.tickersPerRequest ?? 1);

  const readBatch = (
    body: string,
    asked: readonly string[],
    date: DateOnly,
  ): Either<AppError, ClosingResult> =>
    parsing(BRAPI_SOURCE, () => {
      const envelope = asObject(asJson(body, 'body'), 'body');

      // O 404 da brapi tem envelope próprio: `{ error: true, message }`. Ele é
      // resposta sobre o papel, e todos os pedidos daquela chamada ficam
      // `missing`.
      if (envelope['error'] === true) {
        return { quotes: [] as readonly PriceQuote[], missing: asked };
      }

      const results = asArray(at(envelope, ['results']), 'results');

      const quotes: PriceQuote[] = [];
      const found = new Set<string>();

      for (const [index, item] of results.entries()) {
        const where = `results[${index}]`;
        const row = asObject(item, where);

        const ticker = stringField(row, 'symbol', `${where}.symbol`).toUpperCase();

        // Papel sem preço na resposta não é erro de formato: a fonte conhece o
        // ticker e não tem fechamento para ele. Ele fica `missing`.
        if (row[CLOSE_FIELD] === null || row[CLOSE_FIELD] === undefined) continue;

        found.add(ticker);
        quotes.push({
          ticker,
          price_date:
            row[TIME_FIELD] === undefined || row[TIME_FIELD] === null
              ? date
              : dateField(row, TIME_FIELD, `${where}.${TIME_FIELD}`),
          close: decimalField(row, CLOSE_FIELD, `${where}.${CLOSE_FIELD}`),
        });
      }

      return {
        quotes,
        missing: asked.filter((ticker) => !found.has(ticker.toUpperCase())),
      };
    });

  return {
    id: BRAPI_SOURCE,
    supports: SUPPORTED,

    requestsIn: (tickers) => chunk(tickers, perRequest).length,

    fetchClosing: async (tickers, date) => {
      const quotes: PriceQuote[] = [];
      const missing: string[] = [];

      // Sequencial de propósito: o plano gratuito permite uma requisição
      // simultânea, e paralelizar aqui só produziria 429.
      for (const batch of chunk(tickers, perRequest)) {
        const response = await options.http({ url: quoteUrl(batch, options) });
        if (response.isFailure()) return response;

        const read = readBatch(response.value.body, batch, date);
        if (read.isFailure()) return read;

        quotes.push(...read.value.quotes);
        missing.push(...read.value.missing);
      }

      return success({ quotes, missing });
    },

    /**
     * A série histórica. O plano gratuito dá três meses, e é por isso que o
     * COTAHIST existe: dez anos de backfill não saem daqui.
     */
    fetchHistory: async (ticker, from, to) => {
      const response = await options.http({
        url: quoteUrl([ticker], options, { range: '3mo', interval: '1d' }),
      });
      if (response.isFailure()) return response;

      const read = parsing(BRAPI_SOURCE, () => {
        const envelope = asObject(asJson(response.value.body, 'body'), 'body');

        if (envelope['error'] === true) {
          return { quotes: [] as readonly PriceQuote[], missing: [ticker] };
        }

        const results = asArray(at(envelope, ['results']), 'results');
        const first = results[0];
        if (first === undefined) return { quotes: [], missing: [ticker] };

        const row = asObject(first, 'results[0]');
        const series = asArray(
          at(row, ['historicalDataPrice']),
          'results[0].historicalDataPrice',
        );

        const quotes: PriceQuote[] = [];

        for (const [index, point] of series.entries()) {
          const where = `results[0].historicalDataPrice[${index}]`;
          const candle = asObject(point, where);

          // O ponto vem com `date` em epoch de segundos; a conversão é local e
          // sem fuso, porque data de pregão não tem hora.
          const epoch = Number(candle['date']);
          if (!Number.isFinite(epoch)) continue;

          const day = new Date(epoch * 1_000).toISOString().slice(0, 10) as DateOnly;
          if (day < from || day > to) continue;

          quotes.push({
            ticker: ticker.toUpperCase(),
            price_date: day,
            close: decimalField(candle, 'close', `${where}.close`),
          });
        }

        return { quotes, missing: quotes.length === 0 ? [ticker] : [] };
      });

      return read.isFailure() ? read : success(read.value);
    },
  };
};
