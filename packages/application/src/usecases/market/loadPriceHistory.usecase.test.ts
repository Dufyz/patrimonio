import type { Asset, DateOnly, MarketSourceRunDraft } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import { FormatChangedError } from '../../errors/app-error.js';
import type { PriceHistorySource } from '../../interfaces/market_data.js';
import type { AssetPriceWrite } from '../../interfaces/market_ingestion.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { loadPriceHistory } from './loadPriceHistory.usecase.js';

const asset = (ticker: string, overrides: Partial<Asset> = {}): Asset =>
  ({
    id: `id-${ticker}`,
    ticker,
    name: ticker,
    origin: 'market',
    b3_type: 'stock',
    archived_at: null,
    ...overrides,
  }) as Asset;

const harness = (assets: readonly Asset[]) => {
  const prices = new Map<string, AssetPriceWrite>();
  const runs: MarketSourceRunDraft[] = [];
  const events: unknown[] = [];

  const repositories = {
    assets: { list: async () => success([...assets]) },
    market: {
      upsertPrices: async (rows: readonly AssetPriceWrite[]) => {
        for (const row of rows) prices.set(`${row.asset_id}|${row.price_date}`, row);
        return success(rows.length);
      },
      recordRun: async (draft: MarketSourceRunDraft) => {
        runs.push(draft);
        return success(draft);
      },
    },
    ledger: {
      portfoliosHoldingAsset: async () =>
        success([{ portfolio_id: 'carteira', from_date: '2020-01-02' as DateOnly }]),
    },
    outbox: {
      enqueue: async (drafts: readonly unknown[]) => {
        events.push(...drafts);
        return success([]);
      },
    },
  } as unknown as TransactionalRepositories;

  const unitOfWork: UnitOfWork = { run: async (work) => work(repositories) as never };

  return { prices, runs, events, unitOfWork };
};

const clock = {
  now: () => new Date('2026-10-10T12:00:00.000Z'),
  today: () => '2026-10-10' as DateOnly,
};

const history = (
  quotes: ReadonlyArray<{ ticker: string; date: string; close: string }>,
  missing: readonly string[] = [],
): PriceHistorySource => ({
  fetchRange: async () =>
    success({
      quotes: quotes.map((quote) => ({
        ticker: quote.ticker,
        price_date: quote.date as DateOnly,
        close: quote.close,
      })),
      source: 'cotahist',
      lines_read: 1000,
      records_kept: quotes.length,
      missing,
      unavailable_years: [],
    }),
});

const QUOTES = [
  { ticker: 'ITUB4', date: '2024-01-02', close: '31.50' },
  { ticker: 'ITUB4', date: '2024-01-03', close: '31.80' },
];

describe('loadPriceHistory', () => {
  it('grava o preço dos ativos cadastrados e registra a execução', async () => {
    const { prices, runs, unitOfWork } = harness([asset('ITUB4')]);

    const result = await loadPriceHistory({
      unitOfWork,
      clock,
      history: history(QUOTES),
    })({ from_year: 2024, to_year: 2024 });

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value).toMatchObject({ assets: 1, prices_written: 2 });
    expect(prices.size).toBe(2);
    expect(runs[0]).toMatchObject({ kind: 'cotahist', ok: true, items: 2, missing: 0 });
  });

  it('reimportar o mesmo ano não duplica linha', async () => {
    const { prices, unitOfWork } = harness([asset('ITUB4')]);
    const run = loadPriceHistory({ unitOfWork, clock, history: history(QUOTES) });

    await run({ from_year: 2024, to_year: 2024 });
    await run({ from_year: 2024, to_year: 2024 });

    expect(prices.size).toBe(2);
  });

  it('só pede os ativos de mercado com cotação em bolsa', async () => {
    const asked: string[][] = [];
    const { unitOfWork } = harness([
      asset('ITUB4'),
      asset('TD-IPCA-20350515', { b3_type: 'treasury' }),
      asset('CDB-X', { origin: 'manual', b3_type: null }),
      asset('ANTIGO', { archived_at: '2026-01-01T00:00:00Z' }),
    ]);

    await loadPriceHistory({
      unitOfWork,
      clock,
      history: {
        fetchRange: async (tickers) => {
          asked.push([...tickers]);
          return success({
            quotes: [],
            source: 'cotahist',
            lines_read: 0,
            records_kept: 0,
            missing: [],
            unavailable_years: [],
          });
        },
      },
    })({ from_year: 2024, to_year: 2024 });

    expect(asked).toEqual([['ITUB4']]);
  });

  it('papel pedido que não é ativo volta como ausente', async () => {
    const { unitOfWork } = harness([asset('ITUB4')]);

    const result = await loadPriceHistory({
      unitOfWork,
      clock,
      history: history(QUOTES),
    })({ from_year: 2024, to_year: 2024, tickers: ['itub4', 'bova11'] });

    expect(result.isSuccess() && result.value.missing).toEqual(['BOVA11']);
  });

  it('pede o recálculo das carteiras que têm o ativo', async () => {
    const { events, unitOfWork } = harness([asset('ITUB4')]);

    const result = await loadPriceHistory({
      unitOfWork,
      clock,
      history: history(QUOTES),
    })({ from_year: 2024, to_year: 2024 });

    expect(result.isSuccess() && result.value.recalculated).toEqual(['carteira']);
    expect(events).toHaveLength(1);
  });

  it('formato mudado falha e grava a execução com o campo', async () => {
    const { prices, runs, unitOfWork } = harness([asset('ITUB4')]);

    const result = await loadPriceHistory({
      unitOfWork,
      clock,
      history: {
        fetchRange: async () =>
          failure(new FormatChangedError('cotahist', 'preult', 'não numérico', 'ABC')),
      },
    })({ from_year: 2024, to_year: 2024 });

    expect(result.isFailure()).toBe(true);
    expect(prices.size).toBe(0);
    expect(runs[0]).toMatchObject({
      ok: false,
      detail: { field: 'preult', received: 'ABC' },
    });
  });

  it('recusa o intervalo invertido', async () => {
    const { unitOfWork } = harness([asset('ITUB4')]);

    const result = await loadPriceHistory({
      unitOfWork,
      clock,
      history: history([]),
    })({ from_year: 2025, to_year: 2024 });

    expect(result.isFailure()).toBe(true);
  });
});
