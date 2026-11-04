import { FormatChangedError } from '../../errors/app-error.js';
import type { InstrumentWrite } from '../../interfaces/instrument_catalog.repository.js';
import type { TransactionalRepositories } from '../../interfaces/unit-of-work.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { failure, success } from '@patrimonio/shared';
import type { MarketSourceRun, MarketSourceRunDraft } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import { refreshInstrumentCatalog } from './refreshInstrumentCatalog.usecase.js';

const clockAt = (iso: string) => ({
  now: () => new Date(iso),
  today: () => iso.slice(0, 10) as never,
});

const harness = (lastRun: MarketSourceRun | null = null) => {
  const stored = new Map<string, InstrumentWrite>();
  const runs: MarketSourceRunDraft[] = [];

  const repositories = {
    instruments: {
      upsertMany: async (rows: readonly InstrumentWrite[]) => {
        let created = 0;
        let updated = 0;
        for (const row of rows) {
          if (stored.has(row.ticker)) updated += 1;
          else created += 1;
          stored.set(row.ticker, row);
        }
        return success({ created, updated });
      },
      deactivateMissing: async (source: string, keep: readonly string[]) => {
        let changed = 0;
        for (const [ticker, row] of stored) {
          if (row.source === source && row.active && !keep.includes(ticker)) {
            stored.set(ticker, { ...row, active: false });
            changed += 1;
          }
        }
        return success(changed);
      },
    },
    market: {
      lastRunOf: async () => success(lastRun),
      recordRun: async (draft: MarketSourceRunDraft) => {
        runs.push(draft);
        return success(draft as unknown as MarketSourceRun);
      },
    },
  } as unknown as TransactionalRepositories;

  const unitOfWork: UnitOfWork = {
    run: async (work) => work(repositories) as never,
  };

  return { stored, runs, unitOfWork };
};

const source = (
  instruments: ReadonlyArray<{ ticker: string; last: string }>,
  lastDate = '2026-10-09',
) => ({
  fetchInstruments: async () =>
    success({
      instruments: instruments.map((item) => ({
        ticker: item.ticker,
        name: item.ticker,
        b3_type: 'stock' as const,
        last_trade_date: item.last as never,
      })),
      source: 'cotahist',
      last_date: lastDate as never,
      lines_read: 100,
    }),
});

describe('refreshInstrumentCatalog', () => {
  it('grava os papéis, marca como inativo quem parou de negociar e registra a execução', async () => {
    const { stored, runs, unitOfWork } = harness();

    const result = await refreshInstrumentCatalog({
      unitOfWork,
      clock: clockAt('2026-10-10T12:00:00.000Z'),
      instruments: source([
        { ticker: 'ITUB4', last: '2026-10-09' },
        { ticker: 'OIBR3', last: '2026-05-02' },
      ]),
    })({});

    expect(result.isSuccess()).toBe(true);
    if (!result.isSuccess()) return;
    expect(result.value).toMatchObject({ skipped: false, created: 2, updated: 0 });
    expect(stored.get('ITUB4')?.active).toBe(true);
    expect(stored.get('OIBR3')?.active).toBe(false);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: 'cotahist', ok: true, items: 2 });
  });

  it('recarregar não duplica e desativa o que a fonte não trouxe', async () => {
    const { stored, unitOfWork } = harness();
    const clock = clockAt('2026-10-10T12:00:00.000Z');

    await refreshInstrumentCatalog({
      unitOfWork,
      clock,
      instruments: source([
        { ticker: 'ITUB4', last: '2026-10-09' },
        { ticker: 'PETR4', last: '2026-10-09' },
      ]),
    })({});

    const again = await refreshInstrumentCatalog({
      unitOfWork,
      clock,
      instruments: source([{ ticker: 'ITUB4', last: '2026-10-09' }]),
    })({ force: true });

    expect(again.isSuccess() && again.value).toMatchObject({
      created: 0,
      updated: 1,
      deactivated: 1,
    });
    expect(stored.size).toBe(2);
    expect(stored.get('PETR4')?.active).toBe(false);
  });

  it('sai cedo quando a última carga é recente, e roda quando passou de trinta dias', async () => {
    const recent = {
      ok: true,
      finished_at: '2026-10-01T12:00:00.000Z',
    } as unknown as MarketSourceRun;
    const old = {
      ok: true,
      finished_at: '2026-08-01T12:00:00.000Z',
    } as unknown as MarketSourceRun;
    const clock = clockAt('2026-10-10T12:00:00.000Z');

    const skipped = await refreshInstrumentCatalog({
      unitOfWork: harness(recent).unitOfWork,
      clock,
      instruments: source([{ ticker: 'ITUB4', last: '2026-10-09' }]),
    })({});
    expect(skipped.isSuccess() && skipped.value.skipped).toBe(true);

    const reloaded = await refreshInstrumentCatalog({
      unitOfWork: harness(old).unitOfWork,
      clock,
      instruments: source([{ ticker: 'ITUB4', last: '2026-10-09' }]),
    })({});
    expect(reloaded.isSuccess() && reloaded.value.skipped).toBe(false);
  });

  it('formato mudado grava a execução com o campo e o trecho, e devolve o erro', async () => {
    const { runs, unitOfWork, stored } = harness();

    const result = await refreshInstrumentCatalog({
      unitOfWork,
      clock: clockAt('2026-10-10T12:00:00.000Z'),
      instruments: {
        fetchInstruments: async () =>
          failure(new FormatChangedError('cotahist', 'DATA', 'não é uma data', 'abc')),
      },
    })({});

    expect(result.isFailure()).toBe(true);
    expect(stored.size).toBe(0);
    expect(runs[0]).toMatchObject({
      ok: false,
      detail: { field: 'DATA', received: 'abc' },
    });
  });

  it('arquivo sem nenhum papel é erro, e não desativa o catálogo', async () => {
    const { runs, unitOfWork, stored } = harness();
    stored.set('ITUB4', {
      ticker: 'ITUB4',
      name: 'ITAU',
      b3_type: 'stock',
      maturity_date: null,
      source: 'cotahist',
      active: true,
      last_trade_date: null,
    });

    const result = await refreshInstrumentCatalog({
      unitOfWork,
      clock: clockAt('2026-10-10T12:00:00.000Z'),
      instruments: source([]),
    })({ force: true });

    expect(result.isFailure()).toBe(true);
    expect(stored.get('ITUB4')?.active).toBe(true);
    expect(runs[0]).toMatchObject({ ok: false });
  });
});
