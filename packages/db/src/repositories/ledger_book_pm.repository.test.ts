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
import { createLedgerRepository } from './ledger.repository.js';

/**
 * LAN-03.2 · O preço médio antes → depois de cada aporte vem da posição do dia
 * anterior e da posição do dia do aporte. Com dois lançamentos do ativo no
 * mesmo dia, as linhas não se separam: nulo, e não um número que mente.
 */

const CARTEIRA = '0191e5a0-0000-7000-8000-0000000d0001';
const CORRETORA = '0191e5a0-0000-7000-8000-0000000d0011';
const ITUB4 = '0191e5a0-0000-7000-8000-0000000d0031';
const WEGE3 = '0191e5a0-0000-7000-8000-0000000d0032';

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
  await tx`INSERT INTO portfolio (id, name) VALUES (${CARTEIRA}, 'Longo prazo')`;
  await tx`INSERT INTO institution (id, name) VALUES (${CORRETORA}, 'Corretora A')`;
  await tx`
    INSERT INTO asset (id, ticker, name, origin, b3_type) VALUES
      (${ITUB4}, 'ITUB4', 'Itaú', 'market', 'stock'),
      (${WEGE3}, 'WEGE3', 'WEG', 'market', 'stock')
  `;
  await tx`
    INSERT INTO transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
       institution_id, quantity, unit_price, net_amount)
    VALUES
      (GEN_RANDOM_UUID(), 'buy', '2026-10-05', '2026-10-07', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '100', '31.20', '3120.00'),
      (GEN_RANDOM_UUID(), 'buy', '2026-10-12', '2026-10-14', ${CARTEIRA}, ${ITUB4},
       ${CORRETORA}, '100', '31.70', '3170.00'),
      (GEN_RANDOM_UUID(), 'buy', '2026-10-12', '2026-10-14', ${CARTEIRA}, ${WEGE3},
       ${CORRETORA}, '10', '40.00', '400.00'),
      (GEN_RANDOM_UUID(), 'buy', '2026-10-12', '2026-10-14', ${CARTEIRA}, ${WEGE3},
       ${CORRETORA}, '10', '42.00', '420.00')
  `;
  await tx`
    INSERT INTO position_daily
      (portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
       market_value, price_source_kind)
    VALUES
      (${CARTEIRA}, ${ITUB4}, '2026-10-05', '100', '31.20', '3120.00', '3120.00', 'fresh'),
      (${CARTEIRA}, ${ITUB4}, '2026-10-12', '200', '31.45', '6290.00', '6290.00', 'fresh'),
      (${CARTEIRA}, ${WEGE3}, '2026-10-12', '20', '41.00', '820.00', '820.00', 'fresh')
  `;
});
afterEach(async () => {
  await rollbackTestTransaction(tx);
});

describe('PM antes → depois do aporte', () => {
  it('vem da posição do dia anterior e da do dia do aporte', async () => {
    const rows = unwrapSuccess(
      await createLedgerRepository(tx).bookRows({ from: '2026-10-01', to: '2026-10-31' }),
    );
    const second = rows.find((r) => r.asset_name === 'ITUB4' && r.date === '2026-10-12');

    expect(second?.avg_price_before).toBe('31.20000000');
    expect(second?.avg_price_after).toBe('31.45000000');
  });

  it('o primeiro aporte não tem PM antes, e dois no mesmo dia ficam sem PM', async () => {
    const rows = unwrapSuccess(
      await createLedgerRepository(tx).bookRows({ from: '2026-10-01', to: '2026-10-31' }),
    );
    const first = rows.find((r) => r.asset_name === 'ITUB4' && r.date === '2026-10-05');
    const sameDay = rows.filter((r) => r.asset_name === 'WEGE3');

    expect(first?.avg_price_before).toBeNull();
    expect(first?.avg_price_after).toBe('31.20000000');
    expect(sameDay).toHaveLength(2);
    expect(sameDay.every((r) => r.avg_price_after === null)).toBe(true);
  });
});
