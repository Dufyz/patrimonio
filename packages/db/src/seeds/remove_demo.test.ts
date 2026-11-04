import { describe, expect, it } from 'vitest';

import { migrateDatabase } from '../migrations/migrate.js';
import { closeDatabase, createConnection } from '../postgresql.js';
import { withScratchDatabase } from '../testing/database.js';
import { removeDemoData } from './remove_demo.js';

const DEMO_PORTFOLIO = '0191e5a0-0000-7000-8000-0000000a0001';
const REAL_PORTFOLIO = '0191e5a0-0000-7000-8000-0000000a0002';
const DEMO_INSTITUTION = '0191e5a0-0000-7000-8000-0000000b0001';
const REAL_INSTITUTION = '0191e5a0-0000-7000-8000-0000000b0002';
const SHARED_INSTITUTION = '0191e5a0-0000-7000-8000-0000000b0003';
const DEMO_ASSET = '0191e5a0-0000-7000-8000-0000000c0001';
const SHARED_ASSET = '0191e5a0-0000-7000-8000-0000000c0002';
const REAL_ASSET = '0191e5a0-0000-7000-8000-0000000c0003';

const buy = (id: string, portfolio: string, asset: string, institution: string) => ({
  id,
  portfolio,
  asset,
  institution,
});

describe('remoção da demonstração', () => {
  it('apaga a demonstração e preserva o que um lançamento real usa', async () => {
    await withScratchDatabase(async (connection) => {
      await migrateDatabase(connection, { log: () => undefined });

      const sql = createConnection({
        connection,
        poolSize: 1,
        applicationName: 'patrimonio-test',
      });

      try {
        await sql`
          INSERT INTO institution (id, name, is_demo) VALUES
            (${DEMO_INSTITUTION}, 'Corretora demo', TRUE),
            (${SHARED_INSTITUTION}, 'Corretora compartilhada', TRUE),
            (${REAL_INSTITUTION}, 'Corretora real', FALSE)
        `;
        await sql`
          INSERT INTO portfolio (id, name, is_demo) VALUES
            (${DEMO_PORTFOLIO}, 'Demonstração', TRUE),
            (${REAL_PORTFOLIO}, 'Real', FALSE)
        `;
        await sql`
          INSERT INTO asset (id, ticker, name, origin, b3_type, is_demo) VALUES
            (${DEMO_ASSET}, 'DEMO3', 'Só demonstração', 'market', 'stock', TRUE),
            (${SHARED_ASSET}, 'SHAR3', 'Também real', 'market', 'stock', TRUE),
            (${REAL_ASSET}, 'REAL3', 'Real', 'market', 'stock', FALSE)
        `;

        for (const row of [
          buy(
            '0191e5a0-0000-7000-8000-0000000d0001',
            DEMO_PORTFOLIO,
            DEMO_ASSET,
            DEMO_INSTITUTION,
          ),
          buy(
            '0191e5a0-0000-7000-8000-0000000d0002',
            DEMO_PORTFOLIO,
            SHARED_ASSET,
            DEMO_INSTITUTION,
          ),
          buy(
            '0191e5a0-0000-7000-8000-0000000d0003',
            REAL_PORTFOLIO,
            SHARED_ASSET,
            SHARED_INSTITUTION,
          ),
          buy(
            '0191e5a0-0000-7000-8000-0000000d0004',
            REAL_PORTFOLIO,
            REAL_ASSET,
            REAL_INSTITUTION,
          ),
        ]) {
          await sql`
            INSERT INTO transaction (
              id, kind, trade_date, settlement_date, portfolio_id, asset_id,
              institution_id, quantity, unit_price, fees, gross_amount, net_amount
            )
            VALUES (
              ${row.id}, 'buy', '2026-01-05', '2026-01-07', ${row.portfolio}, ${row.asset},
              ${row.institution}, 10, 10, 0, 100, -100
            )
          `;
        }

        await sql`
          INSERT INTO index_quote (index_code, quote_date, daily_factor, source)
          SELECT 'CDI', calendar_date, 1.0005, source
            FROM business_day
            CROSS JOIN (VALUES ('dev-seed'), ('bcb')) AS s(source)
           WHERE calendar_date = '2026-01-05' AND is_business_day
        `;

        const removed = await removeDemoData(sql);

        expect(removed).toMatchObject({
          portfolios: 1,
          transactions: 2,
          assets: 1,
          institutions: 1,
          kept_assets: 1,
          kept_institutions: 1,
        });

        const transactions = await sql<
          { id: string }[]
        >`SELECT id FROM transaction ORDER BY id`;
        expect(transactions.map((row) => row.id)).toEqual([
          '0191e5a0-0000-7000-8000-0000000d0003',
          '0191e5a0-0000-7000-8000-0000000d0004',
        ]);

        const assets = await sql<{ ticker: string; is_demo: boolean }[]>`
          SELECT ticker, is_demo FROM asset ORDER BY ticker
        `;
        expect(assets).toEqual([
          { ticker: 'REAL3', is_demo: false },
          { ticker: 'SHAR3', is_demo: false },
        ]);

        const quotes = await sql<{ source: string }[]>`SELECT source FROM index_quote`;
        expect(quotes).toEqual([{ source: 'bcb' }]);

        const again = await removeDemoData(sql);
        expect(again).toMatchObject({ portfolios: 0, transactions: 0, assets: 0 });
      } finally {
        await closeDatabase(sql);
      }
    });
  });
});
