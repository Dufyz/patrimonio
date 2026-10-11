import type { InstrumentLookup, LookedUpInstrument } from '@patrimonio/application';
import type { InstrumentType } from '@patrimonio/domain';

import type { HttpClient } from '../http/client.js';
import {
  asArray,
  asJson,
  asObject,
  at,
  parsing,
  stringField,
} from '../support/format.js';
import { BRAPI_FREE_MONTHLY_CEILING, BRAPI_SOURCE } from './brapi.provider.js';

/**
 * A busca de papéis da brapi, usada só quando o catálogo local não acha o texto.
 * Uma requisição por busca, contada na cota da brapi.
 *
 * ## O que ela devolve
 *
 * `GET /v2/tickers?search=<texto>&limit=<n>` responde `{ results: [...] }`, e
 * cada item tem `symbol`, `name` e `assetType`. O tipo da brapi é mais grosso que
 * o nosso: `stock` é ação ou unit, `bdr` é BDR, e `fund` junta FII, ETF e outros
 * fundos. Para separá-los, o nome decide — "imobiliário" ou "FII" é FII,
 * "ETF" ou "índice" é ETF — e o fundo que não é nenhum dos dois fica de fora,
 * porque catalogá-lo errado poria um fundo de ações na classe dos FIIs.
 */
export const BRAPI_TICKERS_PATH = '/v2/tickers';

export type BrapiTickersOptions = {
  readonly http: HttpClient;
  readonly token?: string | undefined;
  readonly baseUrl?: string | undefined;
};

export const tickersUrl = (
  text: string,
  limit: number,
  options: BrapiTickersOptions,
): string => {
  const base = options.baseUrl ?? 'https://brapi.dev/api';
  const query = new URLSearchParams({ search: text, limit: String(limit) });

  if (options.token !== undefined && options.token !== '') {
    query.set('token', options.token);
  }

  return `${base}${BRAPI_TICKERS_PATH}?${query.toString()}`;
};

const FII_NAME = /imobili|\bFIIS?\b|\bFIAGRO\b|\bFOF\b/iu;
const ETF_NAME = /\bETF\b|[ií]ndice/iu;

/** O nosso tipo para o da brapi, ou `null` quando não há como saber. */
export const instrumentTypeOf = (
  assetType: string,
  name: string,
): InstrumentType | null => {
  const kind = assetType.trim().toLowerCase();

  if (kind === 'stock') return 'stock';
  if (kind === 'bdr') return 'bdr';
  if (kind === 'fund') {
    if (ETF_NAME.test(name)) return 'etf';
    if (FII_NAME.test(name)) return 'fii';
  }

  return null;
};

export const createBrapiTickerLookup = (
  options: BrapiTickersOptions,
): InstrumentLookup => ({
  id: BRAPI_SOURCE,
  monthlyCeiling: BRAPI_FREE_MONTHLY_CEILING,

  search: async (text, limit) => {
    const response = await options.http({ url: tickersUrl(text, limit, options) });
    if (response.isFailure()) return response;

    return parsing(BRAPI_SOURCE, () => {
      const envelope = asObject(asJson(response.value.body, 'body'), 'body');
      const results = asArray(at(envelope, ['results']), 'results');

      const found: LookedUpInstrument[] = [];

      for (const [index, item] of results.entries()) {
        const where = `results[${index}]`;
        const row = asObject(item, where);

        const ticker = stringField(row, 'symbol', `${where}.symbol`).toUpperCase();
        const name =
          typeof row['name'] === 'string' && row['name'].trim() !== ''
            ? row['name'].trim()
            : ticker;
        const type = instrumentTypeOf(
          stringField(row, 'assetType', `${where}.assetType`),
          name,
        );

        if (type !== null) found.push({ ticker, name, b3_type: type });
      }

      return found;
    });
  },
});
