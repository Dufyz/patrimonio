import type { AppError, IndexProvider, QuoteSource } from '@patrimonio/application';
import { FormatChangedError, MarketDataUnavailableError } from '@patrimonio/application';
import type { DateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import {
  createIndexProviderSet,
  createPriceIndexProvider,
} from './price_index.provider.js';

const ok = <T>(value: T): Either<AppError, T> => success(value);

const quotes = (
  closes: ReadonlyArray<readonly [string, string]>,
  asked: Array<{ ticker: string; from: string; to: string }> = [],
): QuoteSource => ({
  fetchClosing: async () =>
    ok({
      quotes: [],
      missing: [],
      source: 'x',
      source_kind: 'primary',
      requests: 0,
    }),
  fetchHistory: async (ticker, from, to) => {
    asked.push({ ticker, from, to });
    return ok({
      quotes: closes.map(([date, close]) => ({
        ticker,
        price_date: date as DateOnly,
        close,
      })),
      missing: [],
      source: 'brapi',
      source_kind: 'primary',
      requests: 1,
    });
  },
});

describe('o índice de pontos pela cadeia das cotações', () => {
  it('devolve cada fechamento como pontos do índice, com a fonte que respondeu', async () => {
    const provider = createPriceIndexProvider({
      id: 'cotacoes',
      quotes: quotes([['2026-10-08', '131000.5']]),
      symbols: { IBOV: '^BVSP' },
    });

    const result = await provider.fetchSeries(
      ['IBOV'],
      '2026-10-01' as DateOnly,
      '2026-10-09' as DateOnly,
    );

    expect(result.isSuccess() && result.value).toEqual([
      {
        index_code: 'IBOV',
        reference_date: '2026-10-08',
        unit: 'index_points',
        raw_value: '131000.5',
        source: 'brapi',
      },
    ]);
  });

  it('pede alguns dias antes: o primeiro dia precisa do fechamento anterior', async () => {
    const asked: Array<{ ticker: string; from: string; to: string }> = [];
    const provider = createPriceIndexProvider({
      id: 'cotacoes',
      quotes: quotes([], asked),
      symbols: { IBOV: '^BVSP' },
    });

    await provider.fetchSeries(
      ['IBOV'],
      '2026-10-01' as DateOnly,
      '2026-10-09' as DateOnly,
    );

    expect(asked).toEqual([{ ticker: '^BVSP', from: '2026-09-24', to: '2026-10-09' }]);
  });

  it('só serve os índices que têm símbolo configurado', async () => {
    const provider = createPriceIndexProvider({
      id: 'cotacoes',
      quotes: quotes([]),
      symbols: { IBOV: '^BVSP' },
    });

    expect(provider.series).toEqual(['IBOV']);
  });
});

describe('o conjunto de provedores de índice', () => {
  const bcb: IndexProvider = {
    id: 'bcb',
    series: ['CDI'],
    fetchSeries: async () =>
      ok([
        {
          index_code: 'CDI',
          reference_date: '2026-10-08' as DateOnly,
          unit: 'daily_pct',
          raw_value: '0.05',
        },
      ]),
  };

  it('pede cada código a quem o serve e marca a fonte de cada amostra', async () => {
    const set = createIndexProviderSet('indices', [
      bcb,
      createPriceIndexProvider({
        id: 'cotacoes',
        quotes: quotes([['2026-10-08', '131000']]),
        symbols: { IBOV: '^BVSP' },
      }),
    ]);

    const result = await set.fetchSeries(
      ['CDI', 'IBOV'],
      '2026-10-01' as DateOnly,
      '2026-10-09' as DateOnly,
    );

    expect(set.series).toEqual(['CDI', 'IBOV']);
    expect(result.isSuccess() && result.value.map((sample) => sample.source)).toEqual([
      'bcb',
      'brapi',
    ]);
  });

  it('provedor fora do ar não derruba os outros', async () => {
    const down: IndexProvider = {
      id: 'cotacoes',
      series: ['IBOV'],
      fetchSeries: async () => failure(new MarketDataUnavailableError('fora do ar')),
    };

    const result = await createIndexProviderSet('indices', [bcb, down]).fetchSeries(
      ['CDI', 'IBOV'],
      '2026-10-01' as DateOnly,
      '2026-10-09' as DateOnly,
    );

    expect(result.isSuccess() && result.value.map((sample) => sample.index_code)).toEqual(
      ['CDI'],
    );
  });

  it('todos fora do ar é falha', async () => {
    const down = (id: string, code: 'CDI' | 'IBOV'): IndexProvider => ({
      id,
      series: [code],
      fetchSeries: async () => failure(new MarketDataUnavailableError('fora do ar')),
    });

    const result = await createIndexProviderSet('indices', [
      down('bcb', 'CDI'),
      down('cotacoes', 'IBOV'),
    ]).fetchSeries(['CDI', 'IBOV'], '2026-10-01' as DateOnly, '2026-10-09' as DateOnly);

    expect(result.isFailure()).toBe(true);
  });

  it('formato mudado encerra, mesmo havendo amostras de outro provedor', async () => {
    const changed: IndexProvider = {
      id: 'cotacoes',
      series: ['IBOV'],
      fetchSeries: async () =>
        failure(new FormatChangedError('brapi', 'results', 'sumiu', '{}')),
    };

    const result = await createIndexProviderSet('indices', [bcb, changed]).fetchSeries(
      ['CDI', 'IBOV'],
      '2026-10-01' as DateOnly,
      '2026-10-09' as DateOnly,
    );

    expect(result.isFailure()).toBe(true);
  });
});
