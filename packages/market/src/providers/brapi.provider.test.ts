import { FormatChangedError, MarketDataUnavailableError } from '@patrimonio/application';
import type { DateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import { createQuoteChain } from '../chain.js';
import { counting, fixture, replying } from '../testing/recorded.js';
import {
  BRAPI_FREE_MONTHLY_CEILING,
  createBrapiProvider,
  quoteUrl,
} from './brapi.provider.js';
import { BOLSAI_SHAPE, createJsonQuoteProvider } from './json_quote.provider.js';

const UM = fixture('brapi/quote-itub4.json');
const LOTE = fixture('brapi/quote-lote.json');
const NAO_ENCONTRADO = fixture('brapi/quote-nao-encontrado.json');
const HISTORICO = fixture('brapi/historico-3mo.json');

const DATE = '2026-10-06' as DateOnly;

const brapi = (body: string, tickersPerRequest = 1) =>
  createBrapiProvider({ http: replying(body), tickersPerRequest, token: 'segredo' });

describe('o endereço da consulta', () => {
  it('leva os papéis e o token', () => {
    const url = quoteUrl(['ITUB4', 'KNRI11'], { http: replying(''), token: 'abc' });

    expect(url).toBe('https://brapi.dev/api/quote/ITUB4,KNRI11?token=abc');
  });

  it('sem token, não manda um parâmetro vazio', () => {
    expect(quoteUrl(['ITUB4'], { http: replying('') })).toBe(
      'https://brapi.dev/api/quote/ITUB4',
    );
  });
});

describe('resposta normal', () => {
  it('o fechamento sai de regularMarketPrice e a data de regularMarketTime', async () => {
    const result = await brapi(UM).fetchClosing(['ITUB4'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes).toEqual([
      { ticker: 'ITUB4', price_date: '2026-10-06', close: '32.41' },
    ]);
    expect(result.value.missing).toEqual([]);
  });

  it('um pedido cobre vários papéis quando o plano permite', async () => {
    const script = counting(replying(LOTE));
    const provider = createBrapiProvider({ http: script.http, tickersPerRequest: 10 });

    const result = await provider.fetchClosing(['ITUB4', 'KNRI11'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes).toHaveLength(2);
    expect(script.calls()).toBe(1);
  });

  it('no gratuito é um papel por requisição, sequencialmente', async () => {
    const script = counting(replying(UM));
    const provider = createBrapiProvider({ http: script.http, tickersPerRequest: 1 });

    await provider.fetchClosing(['ITUB4', 'KNRI11', 'TAEE11'], DATE);

    expect(script.calls()).toBe(3);
  });

  it('campo novo e desconhecido não derruba a leitura', async () => {
    const body = UM.replace('"currency": "BRL",', '"currency": "BRL", "novoCampo": {},');

    const result = await brapi(body).fetchClosing(['ITUB4'], DATE);

    expect(result.isSuccess()).toBe(true);
  });

  it('o ticker volta em maiúsculas, qualquer que seja o jeito de pedir', async () => {
    const result = await brapi(UM).fetchClosing(['itub4'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes[0]?.ticker).toBe('ITUB4');
    expect(result.value.missing).toEqual([]);
  });
});

describe('o orçamento mensal', () => {
  it('o consumo é contado em requisições, não em papéis', () => {
    const gratuito = createBrapiProvider({ http: replying(''), tickersPerRequest: 1 });
    const pago = createBrapiProvider({ http: replying(''), tickersPerRequest: 10 });

    const trinta = Array.from({ length: 30 }, (_unused, index) => `T${index}`);

    expect(gratuito.requestsIn(trinta)).toBe(30);
    expect(pago.requestsIn(trinta)).toBe(3);
  });

  it('trinta ativos num mês cabem com folga no teto do gratuito', () => {
    const provider = createBrapiProvider({ http: replying(''), tickersPerRequest: 1 });
    const trinta = Array.from({ length: 30 }, (_unused, index) => `T${index}`);

    // 30 ativos × 21 dias úteis = 630, contra 15.000.
    const mensal = provider.requestsIn(trinta) * 21;

    expect(mensal).toBe(630);
    expect(mensal).toBeLessThan(BRAPI_FREE_MONTHLY_CEILING / 10);
  });
});

describe('ticker que a fonte não conhece', () => {
  it('entra em missing e não quebra o lote', async () => {
    const result = await brapi(LOTE, 10).fetchClosing(
      ['ITUB4', 'KNRI11', 'XPTO3'],
      DATE,
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes).toHaveLength(2);
    expect(result.value.missing).toEqual(['XPTO3']);
  });

  it('o 404 da fonte é resposta sobre o papel, não falha da coleta', async () => {
    const result = await brapi(NAO_ENCONTRADO).fetchClosing(['XPTO3'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes).toEqual([]);
    expect(result.value.missing).toEqual(['XPTO3']);
  });

  it('papel conhecido sem preço no dia também fica missing, e nunca zero', async () => {
    const body = UM.replace('"regularMarketPrice": 32.41,', '"regularMarketPrice": null,');

    const result = await brapi(body).fetchClosing(['ITUB4'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes).toEqual([]);
    expect(result.value.missing).toEqual(['ITUB4']);
  });
});

describe('os sete casos de mudança de formato', () => {
  const quebrado = async (body: string) => brapi(body).fetchClosing(['ITUB4'], DATE);

  it('campo ausente: resultado sem symbol', async () => {
    const result = await quebrado('{"results":[{"regularMarketPrice":32.41}]}');

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toBe('results[0].symbol');
  });

  it('tipo trocado: preço como objeto', async () => {
    const result = await quebrado(
      '{"results":[{"symbol":"ITUB4","regularMarketPrice":{"v":32}}]}',
    );

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toBe(
      'results[0].regularMarketPrice',
    );
  });

  it('casa decimal diferente é aceita', async () => {
    const result = await quebrado(
      '{"results":[{"symbol":"ITUB4","regularMarketPrice":32.4}]}',
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes[0]?.close).toBe('32.4');
  });

  it('preço que virou string com vírgula é aceito', async () => {
    const result = await quebrado(
      '{"results":[{"symbol":"ITUB4","regularMarketPrice":"32,41"}]}',
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes[0]?.close).toBe('32.41');
  });

  it('data em outro formato falha nomeando o campo', async () => {
    const result = await quebrado(
      '{"results":[{"symbol":"ITUB4","regularMarketPrice":32.41,"regularMarketTime":"ontem"}]}',
    );

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toBe(
      'results[0].regularMarketTime',
    );
  });

  it('envelope alterado: results virou data', async () => {
    const result = await quebrado('{"data":[{"symbol":"ITUB4"}]}');

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toBe('results');
  });

  it('corpo vazio falha, e não devolve lote vazio', async () => {
    const result = await quebrado('');

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value).toBeInstanceOf(FormatChangedError);
  });

  it('nenhum preço é gravado quando o formato não é reconhecido', async () => {
    const result = await quebrado(
      '{"results":[{"symbol":"ITUB4","regularMarketPrice":32.41},{"symbol":"KNRI11","regularMarketPrice":"caro"}]}',
    );

    expect(result.isFailure()).toBe(true);
  });
});

describe('série histórica', () => {
  it('recorta o intervalo pedido e lê o epoch como data de pregão', async () => {
    const provider = createBrapiProvider({ http: replying(HISTORICO) });

    const result = await provider.fetchHistory?.(
      'ITUB4',
      '2026-09-09' as DateOnly,
      '2026-09-10' as DateOnly,
    );

    expect(result?.isSuccess()).toBe(true);
    if (result === undefined || !result.isSuccess()) return;
    expect(result.value.quotes.map((quote) => quote.price_date)).toEqual([
      '2026-09-09',
      '2026-09-10',
    ]);
    expect(result.value.quotes[0]?.close).toBe('31.8');
  });

  it('intervalo sem ponto nenhum devolve o papel em missing', async () => {
    const provider = createBrapiProvider({ http: replying(HISTORICO) });

    const result = await provider.fetchHistory?.(
      'ITUB4',
      '2015-01-01' as DateOnly,
      '2015-12-31' as DateOnly,
    );

    expect(result?.isSuccess()).toBe(true);
    if (result === undefined || !result.isSuccess()) return;
    expect(result.value.missing).toEqual(['ITUB4']);
  });
});

describe('o provedor alternativo declarado por configuração', () => {
  const alternativo = (body: string) =>
    createJsonQuoteProvider({
      id: 'usebolsai',
      http: replying(body),
      shape: BOLSAI_SHAPE,
      url: (tickers) => `https://exemplo/quotes?tickers=${tickers.join(',')}`,
    });

  it('lê a lista no caminho declarado', async () => {
    const result = await alternativo(
      '{"data":[{"ticker":"ITUB4","close":"31.90","date":"2026-10-06"}]}',
    ).fetchClosing(['ITUB4'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.quotes).toEqual([
      { ticker: 'ITUB4', price_date: '2026-10-06', close: '31.90' },
    ]);
  });

  it('caminho que mudou falha nomeando-o, que é o que a verificação noturna pega', async () => {
    const result = await alternativo('{"resultados":[]}').fetchClosing(['ITUB4'], DATE);

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect((result.value as FormatChangedError).field).toBe('data');
  });

  it('assume quando o principal falha, e o preço nasce como fallback', async () => {
    const principal = createBrapiProvider({
      http: async () => failure(new MarketDataUnavailableError('brapi respondeu 500')),
    });

    const chain = createQuoteChain([
      principal,
      alternativo('{"data":[{"ticker":"ITUB4","close":"31.90","date":"2026-10-06"}]}'),
    ]);

    const result = await chain.fetchClosing(['ITUB4'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.source).toBe('usebolsai');
    expect(result.value.source_kind).toBe('fallback');
    expect(result.value.quotes[0]?.close).toBe('31.90');
  });

  it('o principal volta a ser tentado no ciclo seguinte, sem intervenção', async () => {
    let tentativas = 0;

    const principal = createBrapiProvider({
      http: async () => {
        tentativas += 1;
        return tentativas === 1
          ? failure(new MarketDataUnavailableError('fora do ar'))
          : success({ status: 200, body: UM });
      },
    });

    const chain = createQuoteChain([
      principal,
      alternativo('{"data":[{"ticker":"ITUB4","close":"31.90","date":"2026-10-06"}]}'),
    ]);

    const primeiro = await chain.fetchClosing(['ITUB4'], DATE);
    const segundo = await chain.fetchClosing(['ITUB4'], DATE);

    expect(primeiro.isSuccess() && primeiro.value.source).toBe('usebolsai');
    expect(segundo.isSuccess() && segundo.value.source).toBe('brapi');
  });
});
