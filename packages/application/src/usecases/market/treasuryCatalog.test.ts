import type { DateOnly } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import { describe, expect, it } from 'vitest';

import type { InstrumentWrite } from '../../interfaces/instrument_catalog.repository.js';
import type { TreasuryQuote } from '../../interfaces/market_data.js';
import type { TransactionalRepositories } from '../../interfaces/unit-of-work.js';
import {
  TREASURY_CATALOG_SOURCE,
  treasuryInstruments,
  writeTreasuryCatalog,
} from './treasuryCatalog.js';

const DATE = '2026-10-06' as DateOnly;

const quote = (overrides: Partial<TreasuryQuote> = {}): TreasuryQuote => ({
  kind: 'ipca_plus',
  coupon: false,
  maturity_date: '2035-05-15' as DateOnly,
  quote_date: DATE,
  buy_price: '2985.42',
  sell_price: '2971.08',
  buy_rate: '7.42',
  sell_rate: '7.56',
  ...overrides,
});

describe('os títulos do Tesouro como instrumentos', () => {
  it('nomeia e codifica pelo tipo e pelo vencimento', () => {
    const [row] = treasuryInstruments([quote()]);

    expect(row).toEqual({
      ticker: 'TD-IPCA-20350515',
      name: 'Tesouro IPCA+ 2035',
      b3_type: 'treasury',
      maturity_date: '2035-05-15',
      source: TREASURY_CATALOG_SOURCE,
      active: true,
      last_trade_date: DATE,
    });
  });

  it('o título com juros semestrais não colide com o de mesmo vencimento', () => {
    const rows = treasuryInstruments([quote(), quote({ coupon: true })]);

    expect(rows.map((row) => row.ticker)).toEqual([
      'TD-IPCA-20350515',
      'TD-IPCAJS-20350515',
    ]);
    expect(rows[1]?.name).toBe('Tesouro IPCA+ com Juros Semestrais 2035');
  });

  it('o código é o mesmo em duas cargas', () => {
    expect(treasuryInstruments([quote()])).toEqual(treasuryInstruments([quote()]));
  });
});

describe('a gravação do catálogo do Tesouro', () => {
  const harness = () => {
    const calls: { upsert: InstrumentWrite[][]; keep: (readonly string[])[] } = {
      upsert: [],
      keep: [],
    };

    const repositories = {
      instruments: {
        upsertMany: async (rows: readonly InstrumentWrite[]) => {
          calls.upsert.push([...rows]);
          return success({ created: rows.length, updated: 0 });
        },
        deactivateMissing: async (_source: string, keep: readonly string[]) => {
          calls.keep.push(keep);
          return success(0);
        },
      },
    } as unknown as TransactionalRepositories;

    return { repositories, calls };
  };

  it('grava os títulos e desativa os que saíram da tabela', async () => {
    const { repositories, calls } = harness();

    const result = await writeTreasuryCatalog(repositories, [quote()]);

    expect(result.isSuccess()).toBe(true);
    expect(calls.upsert[0]).toHaveLength(1);
    expect(calls.keep[0]).toEqual(['TD-IPCA-20350515']);
  });

  it('coleta sem cotação não mexe no catálogo', async () => {
    const { repositories, calls } = harness();

    const result = await writeTreasuryCatalog(repositories, []);

    expect(result.isSuccess()).toBe(true);
    expect(calls.upsert).toEqual([]);
    expect(calls.keep).toEqual([]);
  });
});
