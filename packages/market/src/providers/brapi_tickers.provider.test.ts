import { FormatChangedError } from '@patrimonio/application';
import { describe, expect, it } from 'vitest';

import { counting, fixture, replying } from '../testing/recorded.js';
import {
  createBrapiTickerLookup,
  instrumentTypeOf,
  tickersUrl,
} from './brapi_tickers.provider.js';

const BOVA = fixture('brapi/tickers-bova.json');

describe('o endereço da busca', () => {
  it('leva o texto, o limite e o token', () => {
    expect(tickersUrl('bova', 5, { http: replying(''), token: 'abc' })).toBe(
      'https://brapi.dev/api/v2/tickers?search=bova&limit=5&token=abc',
    );
  });

  it('escapa o texto e não manda token vazio', () => {
    expect(tickersUrl('a&b', 5, { http: replying('') })).toBe(
      'https://brapi.dev/api/v2/tickers?search=a%26b&limit=5',
    );
  });
});

describe('o tipo da brapi vira o nosso', () => {
  it.each([
    ['stock', 'ITAU UNIBANCO', 'stock'],
    ['bdr', 'APPLE INC', 'bdr'],
    ['fund', 'ISHARES IBOVESPA FUNDO DE INDICE', 'etf'],
    ['fund', 'KINEA RENDIMENTOS IMOBILIARIOS', 'fii'],
    ['fund', 'FII HECTARE CE', 'fii'],
  ] as const)('%s "%s" é %s', (assetType, name, expected) => {
    expect(instrumentTypeOf(assetType, name)).toBe(expected);
  });

  it('fundo que não é FII nem ETF fica de fora', () => {
    expect(instrumentTypeOf('fund', 'FUNDO DE INVESTIMENTO EM ACOES')).toBeNull();
    expect(instrumentTypeOf('index', 'IBOVESPA')).toBeNull();
  });
});

describe('a busca de papéis', () => {
  it('devolve os papéis que dá para classificar e descarta o resto', async () => {
    const lookup = createBrapiTickerLookup({ http: replying(BOVA) });

    const result = await lookup.search('bova', 10);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.map((item) => [item.ticker, item.b3_type])).toEqual([
      ['BOVA11', 'etf'],
      ['BOVV11', 'etf'],
      ['BOVH11', 'fii'],
      ['BOVA3', 'stock'],
    ]);
  });

  it('uma busca é uma requisição', async () => {
    const http = counting(replying(BOVA));
    const lookup = createBrapiTickerLookup({ http: http.http });

    await lookup.search('bova', 10);

    expect(http.calls()).toBe(1);
  });

  it('resposta sem results é mudança de formato, e nomeia o campo', async () => {
    const lookup = createBrapiTickerLookup({ http: replying('{"data":[]}') });

    const result = await lookup.search('bova', 10);

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value).toBeInstanceOf(FormatChangedError);
    expect((result.value as FormatChangedError).field).toBe('results');
  });

  it('item sem symbol é mudança de formato', async () => {
    const lookup = createBrapiTickerLookup({
      http: replying('{"results":[{"name":"X","assetType":"stock"}]}'),
    });

    const result = await lookup.search('x', 10);

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect((result.value as FormatChangedError).field).toBe('results[0].symbol');
    }
  });
});
