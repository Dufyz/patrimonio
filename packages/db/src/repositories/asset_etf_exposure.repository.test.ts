import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../postgresql.js';
import type { Sql } from '../postgresql.js';
import {
  beginTestTransaction,
  createTestConnection,
  prepareTestDatabase,
  rollbackTestTransaction,
} from '../testing/database.js';
import type { TestTransaction } from '../testing/database.js';
import { createAssetRepository } from './asset.repository.js';

/**
 * EST-02 · O que o ETF expõe define a classe dele. A coluna só existe para
 * ETF: gravar exposição em ação seria uma classe que o tipo contradiz.
 */

let sql: Sql;
let tx: TestTransaction;

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});
afterAll(async () => {
  await closeDatabase(sql);
});
beforeEach(async () => {
  tx = await beginTestTransaction(sql);
});
afterEach(async () => {
  await rollbackTestTransaction(tx);
});

describe('exposição do ETF', () => {
  it('nasce indefinida, grava e volta pelo parser', async () => {
    const assets = createAssetRepository(tx);
    const created = unwrapSuccess(
      await assets.create({
        ticker: 'IVVB11',
        name: 'iShares S&P 500',
        origin: 'market',
        b3_type: 'etf',
      }),
    );
    expect(created.etf_exposure).toBeNull();

    const updated = unwrapSuccess(
      await assets.update(created.id, { etf_exposure: 'acoes_exterior' }),
    );
    expect(updated?.etf_exposure).toBe('acoes_exterior');
  });

  it('ação não aceita exposição', async () => {
    const assets = createAssetRepository(tx);
    const created = unwrapSuccess(
      await assets.create({
        ticker: 'ITUB4',
        name: 'Itaú',
        origin: 'market',
        b3_type: 'stock',
      }),
    );

    const result = await assets.update(created.id, { etf_exposure: 'fiis' });
    expect(result.isFailure()).toBe(true);
  });
});
