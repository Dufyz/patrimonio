import type { DateOnly, MarketSourceRunDraft } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import { FormatChangedError } from '../../errors/app-error.js';
import type { IndexProvider, IndexSample } from '../../interfaces/market_data.js';
import type { IndexQuoteWrite } from '../../interfaces/market_ingestion.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { loadIndexHistory, yearlyWindows } from './loadIndexHistory.usecase.js';

const clock = {
  now: () => new Date('2026-10-10T12:00:00.000Z'),
  today: () => '2026-10-10' as DateOnly,
};

const businessDays = (from: string, to: string) => {
  const days: { calendar_date: DateOnly; is_business_day: boolean }[] = [];
  for (
    let day = new Date(`${from}T00:00:00Z`);
    day <= new Date(`${to}T00:00:00Z`);
    day = new Date(day.getTime() + 86_400_000)
  ) {
    const weekday = day.getUTCDay();
    days.push({
      calendar_date: day.toISOString().slice(0, 10) as DateOnly,
      is_business_day: weekday !== 0 && weekday !== 6,
    });
  }
  return days;
};

const harness = (first: DateOnly | null = '2026-09-28' as DateOnly) => {
  const rows: IndexQuoteWrite[] = [];
  const runs: MarketSourceRunDraft[] = [];
  const events: unknown[] = [];

  const repositories = {
    ledger: { firstTradeDate: async () => success(first) },
    businessDays: {
      listBetween: async (from: string, to: string) => success(businessDays(from, to)),
    },
    portfolios: { list: async () => success([{ id: 'carteira' }]) },
    market: {
      upsertIndexQuotes: async (batch: readonly IndexQuoteWrite[]) => {
        rows.push(...batch);
        return success(batch.length);
      },
      recordRun: async (draft: MarketSourceRunDraft) => {
        runs.push(draft);
        return success(draft);
      },
    },
    outbox: {
      enqueue: async (drafts: readonly unknown[]) => {
        events.push(...drafts);
        return success([]);
      },
    },
  } as unknown as TransactionalRepositories;

  const unitOfWork: UnitOfWork = { run: async (work) => work(repositories) as never };

  return { rows, runs, events, unitOfWork };
};

const provider = (samples: readonly IndexSample[]): IndexProvider => ({
  id: 'indices',
  series: ['CDI', 'IBOV'],
  fetchSeries: async () => success([...samples]),
});

const CDI: IndexSample[] = [
  {
    index_code: 'CDI',
    reference_date: '2026-09-28' as DateOnly,
    unit: 'daily_pct',
    raw_value: '0.055131',
  },
  {
    index_code: 'CDI',
    reference_date: '2026-09-29' as DateOnly,
    unit: 'daily_pct',
    raw_value: '0.055131',
  },
];

describe('yearlyWindows', () => {
  it('parte do início do mês e fecha em janelas de um ano', () => {
    expect(yearlyWindows('2024-03-15' as DateOnly, '2026-10-10' as DateOnly)).toEqual([
      { from: '2024-03-01', to: '2025-02-28' },
      { from: '2025-03-01', to: '2026-02-28' },
      { from: '2026-03-01', to: '2026-10-10' },
    ]);
  });
});

describe('loadIndexHistory', () => {
  it('grava os fatores desde o primeiro lançamento, pede recálculo e registra a execução', async () => {
    const { rows, runs, events, unitOfWork } = harness();

    const result = await loadIndexHistory({
      unitOfWork,
      clock,
      indices: provider(CDI),
    })({});

    expect(result.isSuccess()).toBe(true);
    expect(rows.map((row) => row.quote_date)).toContain('2026-09-29');
    expect(rows.every((row) => row.index_code === 'CDI')).toBe(true);
    expect(events).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: 'indices', ok: true });
    if (result.isSuccess()) {
      expect(result.value.from).toBe('2026-09-28');
      expect(result.value.empty).toEqual(['IBOV']);
    }
  });

  it('recarregar grava a mesma chave, sem acrescentar linha', async () => {
    const { rows, unitOfWork } = harness();
    const run = loadIndexHistory({ unitOfWork, clock, indices: provider(CDI) });

    await run({});
    const keys = new Set(rows.map((row) => `${row.index_code}|${row.quote_date}`));
    await run({});

    expect(new Set(rows.map((row) => `${row.index_code}|${row.quote_date}`))).toEqual(
      keys,
    );
  });

  it('sem lançamentos e sem data informada, recusa', async () => {
    const { unitOfWork } = harness(null);

    const result = await loadIndexHistory({ unitOfWork, clock, indices: provider([]) })(
      {},
    );

    expect(result.isFailure()).toBe(true);
  });

  it('data inicial no futuro é recusada', async () => {
    const { unitOfWork } = harness();

    const result = await loadIndexHistory({ unitOfWork, clock, indices: provider([]) })({
      from: '2027-01-01' as DateOnly,
    });

    expect(result.isFailure()).toBe(true);
  });

  it('uma fonte que falha não impede as outras: o erro vem no resultado', async () => {
    const { rows, runs, unitOfWork } = harness();

    const result = await loadIndexHistory({
      unitOfWork,
      clock,
      indices: {
        id: 'indices',
        series: ['CDI', 'IBOV'],
        fetchSeries: async (codes) =>
          codes.includes('IBOV')
            ? failure(new FormatChangedError('usebolsai', 'body', 'não é JSON', ''))
            : success([...CDI]),
      },
    })({});

    expect(result.isSuccess()).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.index_code === 'CDI')).toBe(true);
    expect(runs[0]).toMatchObject({ kind: 'indices', ok: true });
    if (result.isSuccess()) {
      expect(Object.keys(result.value.failed)).toEqual(['IBOV']);
      expect(result.value.failed['IBOV']).toMatch(/usebolsai/u);
      expect(result.value.empty).toEqual([]);
    }
  });

  it('falha da fonte registra a execução e devolve o erro', async () => {
    const { runs, rows, unitOfWork } = harness();

    const result = await loadIndexHistory({
      unitOfWork,
      clock,
      indices: {
        id: 'indices',
        series: ['CDI'],
        fetchSeries: async () =>
          failure(new FormatChangedError('bcb', 'data', 'mudou', '{}')),
      },
    })({});

    expect(result.isFailure()).toBe(true);
    expect(rows).toHaveLength(0);
    expect(runs[0]).toMatchObject({ kind: 'indices', ok: false });
  });
});
