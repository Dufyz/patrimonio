import type { MarketSourceRunDraft } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import { ExternalServiceError } from '../../errors/app-error.js';
import type { InstrumentLookup } from '../../interfaces/market_data.js';
import type {
  SearchInstrumentRow,
  SearchPageView,
  SearchRepository,
} from '../../interfaces/search.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { searchGlobal } from './searchGlobal.usecase.js';

const PORTFOLIO = '0191e5a0-0000-7000-8000-000000000001';

const view = (overrides: Partial<SearchPageView> = {}): SearchPageView => ({
  assets: { total: 0, rows: [] },
  instruments: { total: 0, rows: [] },
  transactions: { total: 0, rows: [] },
  ...overrides,
});

const catalogRow: SearchInstrumentRow = {
  ticker: 'BOVA11',
  name: 'ISHARES BOVA',
  b3_type: 'etf',
  maturity_date: null,
};

const searching = (result: SearchPageView): SearchRepository => ({
  find: async () => success(result),
});

const clock = {
  now: () => new Date('2026-10-10T15:00:00.000Z'),
  today: () => '2026-10-10' as never,
};

const harness = (used = 0) => {
  const runs: MarketSourceRunDraft[] = [];
  const repositories = {
    market: {
      sourceStatuses: async () =>
        success([
          { source: 'brapi', kind: 'quotes', last_run: null, requests_in_window: used },
          { source: 'bcb', kind: 'indices', last_run: null, requests_in_window: 9999 },
        ]),
      recordRun: async (draft: MarketSourceRunDraft) => {
        runs.push(draft);
        return success(draft as never);
      },
    },
  } as unknown as TransactionalRepositories;
  const unitOfWork: UnitOfWork = { run: async (work) => work(repositories) as never };

  return { runs, unitOfWork };
};

const lookupOf = (
  search: InstrumentLookup['search'],
  monthlyCeiling = 15_000,
): InstrumentLookup => ({ id: 'brapi', monthlyCeiling, search });

describe('searchGlobal · papéis do mercado', () => {
  it('texto vazio não vai ao banco nem à fonte', async () => {
    let calls = 0;
    const result = await searchGlobal({
      search: { find: async () => ((calls += 1), success(view())) },
    })({ text: '  ', portfolioId: PORTFOLIO, limit: 5 });

    expect(calls).toBe(0);
    expect(result.isSuccess() && result.value.instruments.fallback).toBe('none');
  });

  it('o catálogo que achou basta: a fonte ao vivo não é chamada', async () => {
    let asked = 0;
    const { unitOfWork, runs } = harness();

    const result = await searchGlobal({
      search: searching(view({ instruments: { total: 1, rows: [catalogRow] } })),
      lookup: {
        source: lookupOf(async () => ((asked += 1), success([]))),
        unitOfWork,
        clock,
      },
    })({ text: 'bova', portfolioId: PORTFOLIO, limit: 5 });

    expect(asked).toBe(0);
    expect(runs).toHaveLength(0);
    expect(result.isSuccess() && result.value.instruments).toMatchObject({
      total: 1,
      fallback: 'none',
      items: [{ ticker: 'BOVA11', source: 'catalog' }],
    });
  });

  it('sem nada local, consulta a fonte, marca a origem e registra a requisição', async () => {
    const { unitOfWork, runs } = harness();

    const result = await searchGlobal({
      search: searching(view()),
      lookup: {
        source: lookupOf(async () =>
          success([{ ticker: 'BOVV11', name: 'IT NOW BOVV', b3_type: 'etf' as const }]),
        ),
        unitOfWork,
        clock,
      },
    })({ text: 'bovv', portfolioId: PORTFOLIO, limit: 5 });

    expect(result.isSuccess() && result.value.instruments).toMatchObject({
      fallback: 'used',
      items: [{ ticker: 'BOVV11', source: 'brapi' }],
    });
    expect(runs).toEqual([
      expect.objectContaining({
        source: 'brapi',
        kind: 'lookup',
        ok: true,
        requests: 1,
        items: 1,
      }),
    ]);
  });

  it('menos de três letras não gasta cota', async () => {
    let asked = 0;
    const { unitOfWork } = harness();

    const result = await searchGlobal({
      search: searching(view()),
      lookup: {
        source: lookupOf(async () => ((asked += 1), success([]))),
        unitOfWork,
        clock,
      },
    })({ text: 'bo', portfolioId: PORTFOLIO, limit: 5 });

    expect(asked).toBe(0);
    expect(result.isSuccess() && result.value.instruments.fallback).toBe('none');
  });

  it('cota do mês esgotada: não consulta e diz que a fonte está indisponível', async () => {
    let asked = 0;
    const { unitOfWork, runs } = harness(15_000);

    const result = await searchGlobal({
      search: searching(view()),
      lookup: {
        source: lookupOf(async () => ((asked += 1), success([]))),
        unitOfWork,
        clock,
      },
    })({ text: 'bova', portfolioId: PORTFOLIO, limit: 5 });

    expect(asked).toBe(0);
    expect(runs).toHaveLength(0);
    expect(result.isSuccess() && result.value.instruments.fallback).toBe('unavailable');
  });

  it('só conta a cota da própria fonte, não a de outras', async () => {
    const { unitOfWork } = harness(10);

    const result = await searchGlobal({
      search: searching(view()),
      lookup: {
        source: lookupOf(async () => success([]), 100),
        unitOfWork,
        clock,
      },
    })({ text: 'bova', portfolioId: PORTFOLIO, limit: 5 });

    expect(result.isSuccess() && result.value.instruments.fallback).toBe('used');
  });

  it('a fonte que falha não falha a busca: grava a execução e devolve o catálogo', async () => {
    const { unitOfWork, runs } = harness();

    const result = await searchGlobal({
      search: searching(view()),
      lookup: {
        source: lookupOf(async () =>
          failure(new ExternalServiceError('brapi respondeu 503')),
        ),
        unitOfWork,
        clock,
      },
    })({ text: 'bova', portfolioId: PORTFOLIO, limit: 5 });

    expect(result.isSuccess() && result.value.instruments).toMatchObject({
      fallback: 'unavailable',
      items: [],
    });
    expect(runs[0]).toMatchObject({
      ok: false,
      error: 'brapi respondeu 503',
      requests: 1,
    });
  });

  it('com ativo achado, a fonte também não é chamada', async () => {
    let asked = 0;
    const { unitOfWork } = harness();

    const result = await searchGlobal({
      search: searching(
        view({
          assets: {
            total: 1,
            rows: [
              {
                id: PORTFOLIO,
                ticker: 'BOVA11',
                name: 'X',
                b3_type: 'etf',
                quantity: null,
                market_value: null,
                portfolio_names: [],
              },
            ],
          },
        }),
      ),
      lookup: {
        source: lookupOf(async () => ((asked += 1), success([]))),
        unitOfWork,
        clock,
      },
    })({ text: 'bova', portfolioId: PORTFOLIO, limit: 5 });

    expect(asked).toBe(0);
    expect(result.isSuccess()).toBe(true);
  });
});
