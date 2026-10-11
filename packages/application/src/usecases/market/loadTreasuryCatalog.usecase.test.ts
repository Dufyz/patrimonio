import type { DateOnly, MarketSourceRunDraft } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import { MarketDataUnavailableError } from '../../errors/app-error.js';
import type { InstrumentWrite } from '../../interfaces/instrument_catalog.repository.js';
import type { TreasurySource } from '../../interfaces/market_data.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { loadTreasuryCatalog } from './loadTreasuryCatalog.usecase.js';

const clock = {
  now: () => new Date('2026-10-10T12:00:00.000Z'),
  today: () => '2026-10-10' as DateOnly,
};

const harness = () => {
  const written: InstrumentWrite[] = [];
  const runs: MarketSourceRunDraft[] = [];

  const repositories = {
    instruments: {
      upsertMany: async (rows: readonly InstrumentWrite[]) => {
        written.push(...rows);
        return success(rows.length);
      },
      deactivateMissing: async () => success(0),
    },
    market: {
      recordRun: async (draft: MarketSourceRunDraft) => {
        runs.push(draft);
        return success(draft);
      },
    },
  } as unknown as TransactionalRepositories;

  const unitOfWork: UnitOfWork = { run: async (work) => work(repositories) as never };
  return { written, runs, unitOfWork };
};

const source = (quotes: unknown[]): TreasurySource =>
  ({
    fetchQuotes: async () =>
      success({ quotes, source: 'tesouro-direto', source_kind: 'primary' as const }),
    fetchHistory: async () => success({ quotes: [], source: 'x' }),
  }) as unknown as TreasurySource;

const QUOTE = {
  kind: 'ipca_plus',
  coupon: false,
  maturity_date: '2035-05-15',
  quote_date: '2026-10-09',
  buy_price: '1000',
  sell_price: '990',
};

describe('loadTreasuryCatalog', () => {
  it('grava os títulos à venda e registra a execução', async () => {
    const { written, runs, unitOfWork } = harness();

    const result = await loadTreasuryCatalog({
      unitOfWork,
      clock,
      treasury: source([QUOTE]),
    })();

    expect(result.isSuccess() && result.value).toEqual({
      titles: 1,
      source: 'tesouro-direto',
    });
    expect(written.map((row) => row.b3_type)).toEqual(['treasury']);
    expect(runs[0]).toMatchObject({ kind: 'treasury', ok: true, items: 1 });
  });

  it('fonte fora do ar: registra a falha e devolve o erro', async () => {
    const { written, runs, unitOfWork } = harness();

    const result = await loadTreasuryCatalog({
      unitOfWork,
      clock,
      treasury: {
        fetchQuotes: async () => failure(new MarketDataUnavailableError('fora do ar')),
        fetchHistory: async () => failure(new MarketDataUnavailableError('fora do ar')),
      } as unknown as TreasurySource,
    })();

    expect(result.isFailure()).toBe(true);
    expect(written).toHaveLength(0);
    expect(runs[0]).toMatchObject({ kind: 'treasury', ok: false });
  });

  it('sem nenhum título, recusa em vez de esvaziar o catálogo', async () => {
    const { written, unitOfWork } = harness();

    const result = await loadTreasuryCatalog({
      unitOfWork,
      clock,
      treasury: source([]),
    })();

    expect(result.isFailure()).toBe(true);
    expect(written).toHaveLength(0);
  });
});
