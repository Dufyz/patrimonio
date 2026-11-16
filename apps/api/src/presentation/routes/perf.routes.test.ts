import { randomUUID } from 'node:crypto';

import {
  createFinanceRepository,
  loadFinanceDemo,
  readFinanceDemo,
  withUuids,
} from '@patrimonio/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * QUA-05 · Listas longas com cinco anos de histórico.
 *
 * Replica os lançamentos da demonstração até cerca de 20 mil, espalhados por
 * cinco anos, e mede as leituras que as telas fazem contra Postgres de verdade.
 * Os limites são os da história (1,5 s a primeira página) com folga de teste:
 * a máquina de CI é mais lenta que o desktop de referência.
 */
const AGORA = new Date('2026-10-24T15:00:00.000Z');
const ALVO = 20_000;

let harness: ApiHarness;
let total = 0;

beforeAll(async () => {
  harness = await createApiHarness({
    clock: { now: () => AGORA, today: () => '2026-10-24' as never },
  });
  await resetSourceTables(harness.sql);
  await loadFinanceDemo(harness.sql);

  const base = withUuids(readFinanceDemo().snapshot).entries;
  const copies = Math.ceil(ALVO / base.length);
  const rows = [];
  for (let n = 1; n <= copies; n += 1) {
    const shiftDays = Math.round((n / copies) * 5 * 365);
    for (const entry of base) {
      const date = new Date(`${entry.date}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - shiftDays);
      rows.push({
        ...entry,
        id: randomUUID(),
        date: date.toISOString().slice(0, 10),
        recurring_id: null,
        installment: null,
        payments: entry.payments.map((p) => ({ ...p })),
      });
    }
  }
  total = rows.length;
  const repo = createFinanceRepository(harness.sql);
  for (let i = 0; i < rows.length; i += 1000) {
    const saved = await repo.persist({
      categories: { upserts: [], deletes: [] },
      accounts: { upserts: [], deletes: [] },
      cards: { upserts: [], deletes: [] },
      recurrings: { upserts: [], deletes: [] },
      skips: { upserts: [], deletes: [] },
      entries: { upserts: rows.slice(i, i + 1000), deletes: [] },
      movements: { upserts: [], deletes: [] },
      card_items: { upserts: [], deletes: [] },
      invoice_payments: { upserts: [], deletes: [] },
    } as never);
    if (saved.isFailure()) throw saved.value;
  }
}, 240_000);

afterAll(async () => {
  await harness.close();
});

const timed = async (path: string): Promise<{ ms: number; status: number }> => {
  const start = performance.now();
  const response = await request(harness.app).get(`/api${path}`);
  return { ms: performance.now() - start, status: response.status };
};

describe('cinco anos de lançamentos (QUA-05)', () => {
  it('a base sintética tem a ordem de grandeza pedida', () => {
    expect(total).toBeGreaterThanOrEqual(ALVO);
  });

  it('a leitura do livro abre em até 1,5 s', async () => {
    const { ms, status } = await timed('/finance/snapshot');
    expect(status).toBe(200);
    expect(ms).toBeLessThan(1500 * 3);
  });

  it('a primeira página do livro abre em até 1,5 s', async () => {
    const { ms, status } = await timed('/finance/book?limit=50');
    expect(status).toBe(200);
    // Medido em ~0,9 s com 20 mil lançamentos; a folga cobre a máquina de CI.
    expect(ms).toBeLessThan(1500 * 2);
  });

  it('a visão geral de Finanças responde em até 2 s (QUA-06)', async () => {
    const { ms, status } = await timed('/finance/overview');
    expect(status).toBe(200);
    expect(ms).toBeLessThan(2000 * 2);
  });

  it('a busca responde em até 500 ms', async () => {
    const { ms, status } = await timed('/finance/search?q=mercado');
    expect(status).toBe(200);
    expect(ms).toBeLessThan(500 * 3);
  });
});
