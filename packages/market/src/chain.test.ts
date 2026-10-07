import {
  FormatChangedError,
  MarketDataUnavailableError,
  MarketSourceRejectedError,
} from '@patrimonio/application';
import type { ClosingResult, QuoteProvider } from '@patrimonio/application';
import type { DateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import { createQuoteChain } from './chain.js';

type Scripted = {
  readonly id: string;
  readonly answer: () => Either<
    FormatChangedError | MarketDataUnavailableError | MarketSourceRejectedError,
    ClosingResult
  >;
};

const provider = (scripted: Scripted): QuoteProvider => {
  let calls = 0;

  return {
    id: scripted.id,
    supports: ['stock', 'fii', 'etf', 'bdr'],
    requestsIn: (tickers) => tickers.length,
    fetchClosing: async () => {
      calls += 1;
      void calls;
      return scripted.answer();
    },
  };
};

const quoted = (ticker: string, close: string): ClosingResult => ({
  quotes: [{ ticker, price_date: '2026-10-06' as DateOnly, close }],
  missing: [],
});

const DATE = '2026-10-06' as DateOnly;

describe('cadeia de fallback', () => {
  it('o principal respondendo marca source_kind primary e não chama a alternativa', async () => {
    let alternativaChamada = false;

    const chain = createQuoteChain([
      provider({ id: 'brapi', answer: () => success(quoted('ITUB4', '32.00')) }),
      provider({
        id: 'bolsai',
        answer: () => {
          alternativaChamada = true;
          return success(quoted('ITUB4', '99.00'));
        },
      }),
    ]);

    const result = await chain.fetchClosing(['ITUB4'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.source).toBe('brapi');
    expect(result.value.source_kind).toBe('primary');
    expect(result.value.quotes[0]?.close).toBe('32.00');
    expect(alternativaChamada).toBe(false);
  });

  it('fonte fora do ar passa para a alternativa e o preço nasce como fallback', async () => {
    const chain = createQuoteChain([
      provider({
        id: 'brapi',
        answer: () => failure(new MarketDataUnavailableError('brapi respondeu 500')),
      }),
      provider({ id: 'bolsai', answer: () => success(quoted('ITUB4', '31.90')) }),
    ]);

    const result = await chain.fetchClosing(['ITUB4'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.source).toBe('bolsai');
    expect(result.value.source_kind).toBe('fallback');
  });

  it('ticker inexistente volta em missing sem trocar de provedor', async () => {
    let alternativaChamada = false;

    const chain = createQuoteChain([
      provider({
        id: 'brapi',
        answer: () => success({ quotes: [], missing: ['XPTO3'] }),
      }),
      provider({
        id: 'bolsai',
        answer: () => {
          alternativaChamada = true;
          return success(quoted('XPTO3', '10.00'));
        },
      }),
    ]);

    const result = await chain.fetchClosing(['XPTO3'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.missing).toEqual(['XPTO3']);
    expect(result.value.source_kind).toBe('primary');
    expect(alternativaChamada).toBe(false);
  });

  it('formato mudado interrompe a cadeia em vez de esconder o problema', async () => {
    let alternativaChamada = false;

    const chain = createQuoteChain([
      provider({
        id: 'brapi',
        answer: () =>
          failure(
            new FormatChangedError('brapi', 'results.0.regularMarketPrice', 'não é um número', '"x"'),
          ),
      }),
      provider({
        id: 'bolsai',
        answer: () => {
          alternativaChamada = true;
          return success(quoted('ITUB4', '31.90'));
        },
      }),
    ]);

    const result = await chain.fetchClosing(['ITUB4'], DATE);

    expect(result.isFailure()).toBe(true);
    if (!result.isFailure()) return;
    expect(result.value).toBeInstanceOf(FormatChangedError);
    // 4xx: o `defineStage` encerra o job em vez de insistir contra uma API que
    // mudou de contrato.
    expect(result.value.isTransient).toBe(false);
    expect(alternativaChamada).toBe(false);
  });

  it('toda a cadeia fora do ar não grava nada e não falha o estágio', async () => {
    const chain = createQuoteChain([
      provider({
        id: 'brapi',
        answer: () => failure(new MarketDataUnavailableError('fora do ar')),
      }),
      provider({
        id: 'bolsai',
        answer: () => failure(new MarketDataUnavailableError('fora do ar')),
      }),
    ]);

    const result = await chain.fetchClosing(['ITUB4', 'KNRI11'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    // Nenhuma cotação, nenhum zero: os dois papéis ficam marcados e a posição
    // segue valendo o último preço conhecido.
    expect(result.value.quotes).toEqual([]);
    expect(result.value.missing).toEqual(['ITUB4', 'KNRI11']);
    expect(result.value.source_kind).toBe('none');
  });

  it('a ordem da cadeia é a da configuração, não a do código', async () => {
    const elos = [
      provider({ id: 'bolsai', answer: () => success(quoted('ITUB4', '31.90')) }),
      provider({ id: 'brapi', answer: () => success(quoted('ITUB4', '32.00')) }),
    ];

    const result = await createQuoteChain(elos).fetchClosing(['ITUB4'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.source).toBe('bolsai');
    expect(result.value.source_kind).toBe('primary');
  });

  it('o consumo de requisições soma as tentativas, inclusive a que falhou', async () => {
    const chain = createQuoteChain([
      provider({
        id: 'brapi',
        answer: () => failure(new MarketDataUnavailableError('fora do ar')),
      }),
      provider({ id: 'bolsai', answer: () => success(quoted('ITUB4', '31.90')) }),
    ]);

    const result = await chain.fetchClosing(['ITUB4', 'KNRI11', 'TAEE11'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.requests).toBe(6);
  });

  it('fonte que recusa o pedido também passa para a alternativa', async () => {
    const chain = createQuoteChain([
      provider({
        id: 'brapi',
        answer: () => failure(new MarketSourceRejectedError('brapi respondeu 403')),
      }),
      provider({ id: 'bolsai', answer: () => success(quoted('ITUB4', '31.90')) }),
    ]);

    const result = await chain.fetchClosing(['ITUB4'], DATE);

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.source).toBe('bolsai');
  });

  it('histórico pula o elo que não serve série e usa o que serve', async () => {
    const semHistorico = provider({
      id: 'brapi',
      answer: () => success(quoted('ITUB4', '32.00')),
    });

    const comHistorico: QuoteProvider = {
      ...provider({ id: 'bolsai', answer: () => success(quoted('ITUB4', '31.90')) }),
      fetchHistory: async () =>
        success({
          quotes: [
            { ticker: 'ITUB4', price_date: '2015-03-12' as DateOnly, close: '12.34' },
          ],
          missing: [],
        }),
    };

    const result = await createQuoteChain([semHistorico, comHistorico]).fetchHistory(
      'ITUB4',
      '2015-03-12' as DateOnly,
      DATE,
    );

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value.source).toBe('bolsai');
    expect(result.value.quotes[0]?.price_date).toBe('2015-03-12');
  });
});
