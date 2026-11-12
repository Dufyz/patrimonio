import { describe, expect, it } from 'vitest';

import { migrateDatabase } from '../migrations/migrate.js';
import { closeDatabase, createConnection } from '../postgresql.js';
import {
  loadFinanceDemo,
  readFinanceDemo,
  removeFinanceDemo,
  withUuids,
} from '../seeds/finance_demo.js';
import { withScratchDatabase } from '../testing/database.js';
import { createFinanceRepository } from './finance.repository.js';

describe('repositório de Finanças', () => {
  it('a demonstração, lida do banco, dá os mesmos números da semente', async () => {
    await withScratchDatabase(async (connection) => {
      await migrateDatabase(connection, { log: () => undefined });
      const sql = createConnection({
        connection,
        poolSize: 2,
        applicationName: 'patrimonio-test',
      });
      try {
        await loadFinanceDemo(sql);
        const loaded = await createFinanceRepository(sql).load();
        expect(loaded.isSuccess()).toBe(true);
        if (loaded.isFailure()) return;

        const [sum] = await sql<{ receitas: string; despesas: string }[]>`
          SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'RECEITA' AND status = 'LANCADA'), 0)::TEXT AS receitas,
                 COALESCE(SUM(amount) FILTER (WHERE kind = 'DESPESA' AND status = 'LANCADA'), 0)::TEXT AS despesas
            FROM fin_entry WHERE date BETWEEN '2026-10-01' AND '2026-10-31'`;
        expect(sum?.receitas).toBe('16350.00');
        expect(Number(sum?.despesas)).toBeGreaterThan(0);

        // Ida e volta: o que foi lido é a semente com UUIDs (menos a ordem).
        const seed = withUuids(readFinanceDemo().snapshot);
        expect(loaded.value.entries).toHaveLength(seed.entries.length);
        expect(loaded.value.entries.every((e) => e.version === 1)).toBe(true);
      } finally {
        await closeDatabase(sql);
      }
    });
  });

  it('grava só a diferença, incrementa a versão e recusa versão velha', async () => {
    await withScratchDatabase(async (connection) => {
      await migrateDatabase(connection, { log: () => undefined });
      const sql = createConnection({
        connection,
        poolSize: 2,
        applicationName: 'patrimonio-test',
      });
      try {
        await loadFinanceDemo(sql);
        const repository = createFinanceRepository(sql);
        const before = (await repository.load()).value as ReturnType<typeof withUuids>;
        const target = before.categories[0];
        if (target === undefined) throw new Error('sem categoria');

        const renamed = { ...target, name: 'Renomeada' };
        const change = (rows: readonly unknown[]) => ({
          upserts: rows,
          deletes: [] as string[],
        });
        const empty = change([]);
        const changes = {
          categories: change([renamed]),
          accounts: empty,
          cards: empty,
          recurrings: empty,
          skips: empty,
          entries: empty,
          movements: empty,
          card_items: empty,
          invoice_payments: empty,
        } as unknown as Parameters<typeof repository.persist>[0];
        const first = await repository.persist(changes);
        expect(first.isSuccess()).toBe(true);

        const after = (await repository.load()).value as typeof before;
        expect(after.categories.find((c) => c.id === target.id)?.version).toBe(2);

        // A foto velha ainda leva versão 1: conflito.
        const stale = await repository.persist(changes);
        expect(stale.isFailure()).toBe(true);
        if (stale.isFailure()) expect(stale.value.statusCode).toBe(409);
      } finally {
        await closeDatabase(sql);
      }
    });
  });

  it('perna financeira de aporte, resgate e provento guarda o event_id (LIV-01)', async () => {
    await withScratchDatabase(async (connection) => {
      await migrateDatabase(connection, { log: () => undefined });
      const sql = createConnection({
        connection,
        poolSize: 2,
        applicationName: 'patrimonio-test',
      });
      try {
        await loadFinanceDemo(sql);
        const repository = createFinanceRepository(sql);
        const before = (await repository.load()).value as ReturnType<typeof withUuids>;
        const account = before.accounts[0];
        if (account === undefined) throw new Error('sem conta');
        const eventId = '00000000-0000-4000-8000-000000000a01';
        const legs = [
          { kind: 'aporte', amount: '-500.00' },
          { kind: 'resgate', amount: '300.00' },
          { kind: 'provento', amount: '12.34' },
        ].map((leg, index) => ({
          id: `00000000-0000-4000-8000-0000000000b${index}`,
          date: '2026-11-10',
          account_id: account.id,
          kind: leg.kind,
          amount: leg.amount,
          description: leg.kind,
          note: null,
          transfer_id: null,
          event_id: eventId,
        }));
        const change = (rows: readonly unknown[]) => ({
          upserts: rows,
          deletes: [] as string[],
        });
        const empty = change([]);
        const written = await repository.persist({
          categories: empty,
          accounts: empty,
          cards: empty,
          recurrings: empty,
          skips: empty,
          entries: empty,
          movements: change(legs),
          card_items: empty,
          invoice_payments: empty,
        } as unknown as Parameters<typeof repository.persist>[0]);
        if (written.isFailure()) throw new Error(JSON.stringify(written.value));

        const after = (await repository.load()).value as typeof before;
        const read = after.movements.filter((m) => m.event_id === eventId);
        expect(read.map((m) => m.kind).sort()).toEqual(['aporte', 'provento', 'resgate']);
      } finally {
        await closeDatabase(sql);
      }
    });
  });

  it('o fixture unificado carrega, lê de volta e sai por inteiro (LIV-16)', async () => {
    await withScratchDatabase(async (connection) => {
      await migrateDatabase(connection, { log: () => undefined });
      const sql = createConnection({
        connection,
        poolSize: 2,
        applicationName: 'patrimonio-test',
      });
      try {
        await loadFinanceDemo(sql, 'unified_fixture');
        const seed = readFinanceDemo('unified_fixture').snapshot;
        const loaded = (await createFinanceRepository(sql).load()).value as ReturnType<
          typeof withUuids
        >;
        expect(loaded.accounts).toHaveLength(3);
        expect(loaded.cards).toHaveLength(3);
        expect(loaded.entries).toHaveLength(seed.entries.length);
        expect(loaded.movements.map((m) => m.kind)).toEqual(['aporte']);
        expect(loaded.movements[0]?.event_id).not.toBeNull();
        // Nenhuma categoria "Investimento": o aporte não é despesa de consumo.
        expect(loaded.categories.some((c) => c.name === 'Investimento')).toBe(false);

        await removeFinanceDemo(sql);
        const [left] = await sql<
          { n: string }[]
        >`SELECT COUNT(*)::TEXT AS n FROM fin_entry`;
        expect(left?.n).toBe('0');
      } finally {
        await closeDatabase(sql);
      }
    });
  });

  it('a soma dos pagamentos é garantida pelo banco', async () => {
    await withScratchDatabase(async (connection) => {
      await migrateDatabase(connection, { log: () => undefined });
      const sql = createConnection({
        connection,
        poolSize: 2,
        applicationName: 'patrimonio-test',
      });
      try {
        await loadFinanceDemo(sql);
        await expect(
          sql`UPDATE fin_entry_payment SET amount = amount + 1 WHERE entry_id = (SELECT id FROM fin_entry LIMIT 1)`,
        ).rejects.toThrow();
      } finally {
        await closeDatabase(sql);
      }
    });
  });

  it('remover a demonstração apaga tudo e é repetível', async () => {
    await withScratchDatabase(async (connection) => {
      await migrateDatabase(connection, { log: () => undefined });
      const sql = createConnection({
        connection,
        poolSize: 2,
        applicationName: 'patrimonio-test',
      });
      try {
        await loadFinanceDemo(sql);
        const removed = await removeFinanceDemo(sql);
        expect(removed.entries).toBeGreaterThan(100);
        const [left] = await sql<
          { n: string }[]
        >`SELECT (SELECT COUNT(*) FROM fin_entry)::TEXT AS n`;
        expect(left?.n).toBe('0');
        const again = await removeFinanceDemo(sql);
        expect(again.entries).toBe(0);
      } finally {
        await closeDatabase(sql);
      }
    });
  });
});
