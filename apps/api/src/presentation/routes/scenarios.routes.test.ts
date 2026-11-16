import { loadFinanceDemo } from '@patrimonio/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/** 11/11/2026, 12h em São Paulo: o dia de referência do fixture unificado (§8 da especificação). */
const AGORA = new Date('2026-11-11T15:00:00.000Z');

let harness: ApiHarness;
let ids: Record<string, string>;

beforeAll(async () => {
  harness = await createApiHarness({
    clock: { now: () => AGORA, today: () => '2026-11-11' as never },
  });
});
afterAll(async () => {
  await harness.close();
});

const get = (path: string) => request(harness.app).get(`/api/finance${path}`);
const send = (method: 'post' | 'put' | 'delete', path: string, body?: object) =>
  request(harness.app)[method](`/api/finance${path}`).send(body);

beforeEach(async () => {
  await resetSourceTables(harness.sql);
  await loadFinanceDemo(harness.sql, 'unified_fixture');
  const [categories, accounts, cards] = await Promise.all([
    get('/categories'),
    get('/accounts'),
    get('/cards'),
  ]);
  ids = {};
  for (const c of categories.body.categories) ids[`cat:${c.name}`] = c.id;
  for (const a of accounts.body.accounts) ids[`acc:${a.account.name}`] = a.account.id;
  for (const c of cards.body.cards) ids[`card:${c.card.name}`] = c.card.id;
});

const balanceOf = async (name: string): Promise<string> => {
  const response = await get('/accounts');
  const found = response.body.accounts.find(
    (a: { account: { name: string } }) => a.account.name === name,
  );
  return found.balance;
};

describe('CU-07 · estado inicial: faturas maiores que contas', () => {
  it('Em contas 1.462,51; devido 4.268,37; livre 0,00; faltam 2.805,86', async () => {
    const wealth = await get('/wealth');
    expect(wealth.body.em_contas).toBe('1462.51');
    expect(wealth.body.total_devido).toBe('4268.37');
    expect(wealth.body.abertas).toBe('2167.42');
    expect(wealth.body.fechadas_a_pagar).toBe('2100.95');
    expect(wealth.body.livre).toBe('0.00');
    expect(wealth.body.falta).toBe('2805.86');
  });
});

describe('CU-02 · pagar fatura fechada', () => {
  it('debita a conta e a dívida por igual, sem mexer em Despesas', async () => {
    const before = await get('/overview?month=2026-11');
    const card = ids['card:Itaú Visa'] as string;
    const paid = await send('post', `/cards/${card}/invoices/2026-11/payments`, {
      date: '2026-11-11',
      amount: '300.00',
    });
    expect(paid.status).toBe(201);

    expect(await balanceOf('Itaú Unibanco')).toBe('139.65');
    const wealth = await get('/wealth');
    expect(wealth.body.em_contas).toBe('1162.51');
    expect(wealth.body.total_devido).toBe('3968.37');
    expect(wealth.body.livre).toBe('0.00');
    expect(wealth.body.falta).toBe('2805.86');

    const after = await get('/overview?month=2026-11');
    expect(after.body.despesas.amount).toBe(before.body.despesas.amount);
    expect(after.body.saldo).toBe(before.body.saldo);

    const invoice = await get(`/cards/${card}/invoices/2026-11`);
    expect(invoice.body.summary.status).toBe('paga');
  });
});

describe('CU-06 · lançar previsto de recorrente', () => {
  it('lança com valor real, é idempotente e não altera o recorrente', async () => {
    const created = await send('post', '/recurrings', {
      name: 'Freela recorrente',
      kind: 'receita',
      category_id: ids['cat:Salário'] ?? ids['cat:Freela'] ?? Object.values(ids)[0],
      source: { type: 'conta', id: ids['acc:Nubank Conta'] },
      day: 25,
      mode: 'manual',
      amount: '1500.00',
    });
    expect(created.status).toBe(201);
    await send('post', '/jobs/sync');
    const planned = await get('/entries?month=2026-11&status=prevista&limit=50');
    const target = planned.body.entries.find(
      (e: { amount: string; recurring_id: string | null }) =>
        e.amount === '1500.00' && e.recurring_id !== null,
    );
    expect(target).toBeDefined();
    const before = await get('/overview?month=2026-11');

    const first = await send('post', `/entries/${target.id}/confirm`, {
      amount: '1480.00',
    });
    expect(first.status).toBe(200);
    expect(first.body.entry.status).toBe('lancada');
    const again = await send('post', `/entries/${target.id}/confirm`, {
      amount: '1480.00',
    });
    expect(again.status).toBe(200);

    const after = await get('/overview?month=2026-11');
    expect(
      Number(after.body.receitas.amount) - Number(before.body.receitas.amount),
    ).toBeCloseTo(1480, 2);
    expect(Number(after.body.saldo) - Number(before.body.saldo)).toBeCloseTo(1480, 2);
    expect(
      Number(before.body.a_lancar.amount) - Number(after.body.a_lancar.amount),
    ).toBeCloseTo(1500, 2);

    const recurrings = await get('/recurrings');
    const recurring = recurrings.body.recurrings.find(
      (r: { id: string }) => r.id === target.recurring_id,
    );
    expect(recurring.amount).toBe('1500.00');
  });
});

describe('CU-19 · excluir categoria em uso com destino', () => {
  it('move lançamentos e mantém o total de Despesas', async () => {
    const before = await get('/overview?month=2026-11');
    const origem = ids['cat:Mercado'] as string;
    const destino = ids['cat:Restaurantes'] ?? ids['cat:Lazer'];
    expect(destino).toBeDefined();
    const response = await send('post', `/categories/${origem}/delete`, {
      move_to: destino,
    });
    expect(response.status).toBe(200);
    const after = await get('/overview?month=2026-11');
    expect(after.body.despesas.amount).toBe(before.body.despesas.amount);
    const categories = await get('/categories');
    expect(categories.body.categories.some((c: { id: string }) => c.id === origem)).toBe(
      false,
    );
  });
});

describe('CU-21 · despesa em duas origens', () => {
  it('conta uma vez em Despesas e cada conta cai pela sua parte', async () => {
    const before = await get('/overview?month=2026-11');
    const itau = await balanceOf('Itaú Unibanco');
    const nubank = await balanceOf('Nubank Conta');
    const body = {
      kind: 'despesa',
      description: 'Jantar em grupo',
      date: '2026-11-11',
      category_id: ids['cat:Restaurantes'] ?? ids['cat:Lazer'],
      amount: '200.00',
      payments: [
        { source_type: 'conta', source_id: ids['acc:Itaú Unibanco'], amount: '120.00' },
        { source_type: 'conta', source_id: ids['acc:Nubank Conta'], amount: '80.00' },
      ],
    };
    const wrong = await send('post', '/entries', {
      ...body,
      payments: [body.payments[0], { ...body.payments[1], amount: '70.00' }],
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('ENTRY_SPLIT_MISMATCH');
    expect(wrong.body.details.missing).toBe('10.00');

    const ok = await send('post', '/entries', body);
    expect(ok.status).toBe(201);
    const after = await get('/overview?month=2026-11');
    expect(
      Number(after.body.despesas.amount) - Number(before.body.despesas.amount),
    ).toBeCloseTo(200, 2);
    expect(Number(itau) - Number(await balanceOf('Itaú Unibanco'))).toBeCloseTo(120, 2);
    expect(Number(nubank) - Number(await balanceOf('Nubank Conta'))).toBeCloseTo(80, 2);
  });
});

describe('CU-22 · compra parcelada no cartão', () => {
  it('gera 6 parcelas, a primeira na fatura aberta, sem mexer em Em contas', async () => {
    const before = await get('/wealth');
    const response = await send('post', '/entries', {
      kind: 'despesa',
      description: 'Geladeira',
      date: '2026-11-10',
      category_id: ids['cat:Mercado'],
      amount: '3000.00',
      installments: 6,
      payments: [{ source_type: 'cartao', source_id: ids['card:Nubank Mastercard'] }],
    });
    expect(response.status).toBe(201);
    const items = await get('/entries?month=2026-11&q=Geladeira');
    expect(items.body.entries.length).toBeGreaterThanOrEqual(1);
    const later = await get('/entries?month=2027-04&q=Geladeira&limit=10');
    expect(later.body.entries.length).toBe(1);
    expect(later.body.entries[0].status).toBe('prevista');

    const after = await get('/wealth');
    expect(after.body.em_contas).toBe(before.body.em_contas);
    expect(Number(after.body.abertas)).toBeGreaterThan(Number(before.body.abertas));
  });
});
