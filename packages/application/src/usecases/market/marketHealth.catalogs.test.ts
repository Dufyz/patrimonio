import type { DateOnly } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import type { CatalogStat } from '../../interfaces/market_ingestion.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { getMarketHealth } from './marketHealth.usecase.js';

const clock = {
  now: () => new Date('2026-10-10T12:00:00.000Z'),
  today: () => '2026-10-10' as DateOnly,
};

const harness = (
  stats: CatalogStat[],
  demo = { portfolios: 0, assets: 0, institutions: 0 },
  calendar: readonly { calendar_date: string; is_business_day: boolean }[] = [],
  onPriceDate: { value: string | null } = { value: null },
) => {
  const repositories = {
    businessDays: { listBetween: async () => success(calendar) },
    market: {
      sourceStatuses: async () => success([]),
      recentFailures: async () => success([]),
      priceableAssets: async () => success([]),
      catalogStats: async () => success(stats),
      demoCounts: async () => success(demo),
      lastRunOf: async (source: string) =>
        success(
          source === 'cotahist-catalog'
            ? {
                ok: true,
                finished_at: '2026-10-09T09:00:00.000Z',
              }
            : null,
        ),
    },
    prices: {
      assetsWithoutPriceOn: async (date: string) => {
        onPriceDate.value = date;
        return success([]);
      },
      latestPricesOn: async () => success([]),
    },
  } as unknown as TransactionalRepositories;

  const unitOfWork: UnitOfWork = { run: async (work) => work(repositories) as never };
  return unitOfWork;
};

const stat = (key: CatalogStat['key'], total: number, last: string | null = null) => ({
  key,
  total,
  last_loaded: last,
});

describe('catálogos na saúde de mercado', () => {
  it('catálogo vazio é pendência; o que tem registro é carregado', async () => {
    const result = await getMarketHealth({
      unitOfWork: harness([
        stat('institutions', 300, '2026-10-01T00:00:00.000Z'),
        stat('treasury', 0),
      ]),
      clock,
    })({});

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;

    expect(result.value.catalogs).toEqual([
      {
        key: 'institutions',
        total: 300,
        last_loaded: '2026-10-01T00:00:00.000Z',
        state: 'loaded',
      },
      { key: 'treasury', total: 0, last_loaded: null, state: 'pending' },
    ]);
  });

  it('a última carga vem da execução registrada, quando existe', async () => {
    const result = await getMarketHealth({
      unitOfWork: harness([stat('instruments', 1800, '2026-01-01T00:00:00.000Z')]),
      clock,
    })({});

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;

    expect(result.value.catalogs[0]?.last_loaded).toBe('2026-10-09T09:00:00.000Z');
  });

  it('no fim de semana, "do dia" é o último pregão e não o domingo', async () => {
    const asked = { value: null as string | null };
    const result = await getMarketHealth({
      unitOfWork: harness(
        [],
        undefined,
        [
          { calendar_date: '2026-10-08', is_business_day: true },
          { calendar_date: '2026-10-09', is_business_day: true },
          { calendar_date: '2026-10-10', is_business_day: false },
          { calendar_date: '2026-10-11', is_business_day: false },
        ],
        asked,
      ),
      clock: {
        now: () => new Date('2026-10-11T15:00:00.000Z'),
        today: () => '2026-10-11' as DateOnly,
      },
    })({});

    expect(result.isSuccess() && result.value.reference_date).toBe('2026-10-09');
    expect(asked.value).toBe('2026-10-09');
  });

  it('devolve a contagem de demonstração', async () => {
    const result = await getMarketHealth({
      unitOfWork: harness([], { portfolios: 4, assets: 37, institutions: 8 }),
      clock,
    })({});

    expect(result.isSuccess() && result.value.demo).toEqual({
      portfolios: 4,
      assets: 37,
      institutions: 8,
    });
  });
});
