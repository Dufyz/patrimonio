import { loadFinanceDemo } from '@patrimonio/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/** 24/10/2026, 12h em São Paulo: o dia de referência da demonstração. */
const AGORA = new Date('2026-10-24T15:00:00.000Z');

let harness: ApiHarness;
let ids: Record<string, string>;

beforeAll(async () => {
  harness = await createApiHarness({
    clock: { now: () => AGORA, today: () => '2026-10-24' as never },
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
  await loadFinanceDemo(harness.sql);
  const [categories, accounts, cards] = await Promise.all([
    get('/categories'),
    get('/accounts?include_archived=true'),
    get('/cards'),
  ]);
  ids = {};
  for (const c of categories.body.categories) ids[`cat:${c.name}`] = c.id;
  for (const a of accounts.body.accounts) ids[`acc:${a.account.name}`] = a.account.id;
  for (const c of cards.body.cards) ids[`card:${c.card.name}`] = c.card.id;
});

describe('snapshot', () => {
  it('devolve todas as coleções e o hoje do servidor', async () => {
    const response = await get('/snapshot');
    expect(response.status).toBe(200);
    expect(response.body.today).toBe('2026-10-24');
    for (const key of [
      'categories',
      'accounts',
      'cards',
      'recurrings',
      'skips',
      'entries',
      'movements',
      'card_items',
      'invoice_payments',
    ]) {
      expect(Array.isArray(response.body[key])).toBe(true);
    }
    expect(response.body.entries.length).toBeGreaterThan(0);
  });
});

describe('visão geral (CE-01 a CE-03)', () => {
  it('os números da tela batem com a semente', async () => {
    const response = await get('/overview?month=2026-10');
    expect(response.status).toBe(200);
    expect(response.body.receitas.amount).toBe('16350.00');
    expect(response.body.despesas.amount).toBe('9478.10');
    expect(response.body.saldo).toBe('6871.90');
    expect(response.body.em_contas.amount).toBe('12583.85');
    expect(response.body.faturas_abertas).toBe('5422.27');
    expect(response.body.months).toHaveLength(12);
  });

  it('sem mês pedido, usa o mês de hoje', async () => {
    const response = await get('/overview');
    expect(response.body.month).toBe('2026-10');
  });
});

describe('lançamentos', () => {
  it('lista com indicadores, filtros e cursor', async () => {
    const page = await get('/entries?month=2026-10&limit=5');
    expect(page.status).toBe(200);
    expect(page.body.entries).toHaveLength(5);
    expect(page.body.next_cursor).not.toBeNull();
    expect(page.body.indicators.receitas.amount).toBe('16350.00');

    const next = await get(
      `/entries?month=2026-10&limit=5&cursor=${page.body.next_cursor}`,
    );
    const first = new Set(page.body.entries.map((e: { id: string }) => e.id));
    expect(next.body.entries.every((e: { id: string }) => !first.has(e.id))).toBe(true);

    const food = await get(`/entries?month=2026-10&category_id=${ids['cat:Mercado']}`);
    expect(
      food.body.entries.every(
        (e: { category_id: string }) => e.category_id === ids['cat:Mercado'],
      ),
    ).toBe(true);
  });

  it('CE-04 · divisão que não fecha devolve ENTRY_SPLIT_MISMATCH com o que falta', async () => {
    const response = await send('post', '/entries', {
      kind: 'despesa',
      description: 'Jantar',
      date: '2026-10-24',
      category_id: ids['cat:Restaurantes'],
      amount: '100.00',
      payments: [
        { source_type: 'conta', source_id: ids['acc:Itaú Corrente'], amount: '40.00' },
        { source_type: 'conta', source_id: ids['acc:Nubank Conta'], amount: '40.00' },
      ],
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ENTRY_SPLIT_MISMATCH');
    expect(response.body.details.missing).toBe('20.00');
  });

  it('CE-05 · compra parcelada vira N parcelas; o resto de centavos fica na primeira', async () => {
    const response = await send('post', '/entries', {
      kind: 'despesa',
      description: 'Notebook',
      date: '2026-10-24',
      category_id: ids['cat:Eletrônicos'],
      amount: '100.00',
      installments: 3,
      payments: [{ source_type: 'cartao', source_id: ids['card:Nubank Mastercard'] }],
    });
    expect(response.status).toBe(201);
    const amounts = response.body.entries.map((e: { amount: string }) => e.amount);
    expect(amounts).toEqual(['33.34', '33.33', '33.33']);
    expect(response.body.entries[0].installment.total).toBe(3);
  });

  it('CE-06 · editar ou excluir parcela sem escopo é recusado', async () => {
    const created = await send('post', '/entries', {
      kind: 'despesa',
      description: 'Sofá',
      date: '2026-10-24',
      category_id: ids['cat:Moradia'],
      amount: '300.00',
      installments: 3,
      payments: [{ source_type: 'cartao', source_id: ids['card:Nubank Mastercard'] }],
    });
    const id = created.body.entries[1].id;

    const remove = await send('delete', `/entries/${id}`);
    expect(remove.status).toBe(422);
    expect(remove.body.code).toBe('INSTALLMENT_SCOPE_REQUIRED');

    const scoped = await send('delete', `/entries/${id}?scope=seguintes`);
    expect(scoped.status).toBe(200);
    const left = await get('/entries?month=2026-11&q=Sofá');
    expect(left.body.entries).toHaveLength(0);
  });

  it('CE-07 · confirmar um previsto é idempotente e não toca o recorrente', async () => {
    const planned = await get('/entries?month=2026-10&status=prevista&limit=50');
    const target = planned.body.entries.find(
      (e: { recurring_id: string | null }) => e.recurring_id !== null,
    );
    expect(target).toBeDefined();

    const first = await send('post', `/entries/${target.id}/confirm`, {
      amount: target.amount,
    });
    expect(first.status).toBe(200);
    expect(first.body.entry.status).toBe('lancada');

    const again = await send('post', `/entries/${target.id}/confirm`, {
      amount: target.amount,
    });
    expect(again.status).toBe(200);
    expect(again.body.entry.status).toBe('lancada');

    const overview = await get('/overview?month=2026-10');
    const expected =
      Number(target.kind === 'despesa' ? '9478.10' : '16350.00') + Number(target.amount);
    expect(
      Number(overview.body[target.kind === 'despesa' ? 'despesas' : 'receitas'].amount),
    ).toBeCloseTo(expected, 2);
  });

  it('preview devolve o mesmo efeito da gravação, sem gravar', async () => {
    const body = {
      kind: 'despesa',
      description: 'Café',
      date: '2026-10-24',
      category_id: ids['cat:Restaurantes'],
      amount: '12.50',
      payments: [{ source_type: 'conta', source_id: ids['acc:Itaú Corrente'] }],
    };
    const preview = await send('post', '/entries?preview=true', body);
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toBe(true);

    const before = await get('/overview?month=2026-10');
    expect(before.body.despesas.amount).toBe('9478.10');

    const applied = await send('post', '/entries', body);
    expect(applied.status).toBe(201);
    expect(applied.body.effect).toEqual(preview.body.effect);

    const after = await get('/overview?month=2026-10');
    expect(after.body.despesas.amount).toBe('9490.60');
  });

  it('exporta CSV com ponto e vírgula, vírgula decimal e BOM', async () => {
    const response = await get('/entries/export?month=2026-10');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text.startsWith('﻿Data;Tipo;Descrição')).toBe(true);
    expect(response.text).toMatch(/;-?\d+,\d{2}\r\n/);
  });
});

describe('idempotência e versão', () => {
  const body = () => ({
    kind: 'despesa',
    description: 'Padaria',
    date: '2026-10-24',
    category_id: ids['cat:Mercado'],
    amount: '8.00',
    payments: [{ source_type: 'conta', source_id: ids['acc:Itaú Corrente'] }],
  });

  it('a mesma Idempotency-Key não duplica', async () => {
    const one = await request(harness.app)
      .post('/api/finance/entries')
      .set('Idempotency-Key', 'k-1')
      .send(body());
    const two = await request(harness.app)
      .post('/api/finance/entries')
      .set('Idempotency-Key', 'k-1')
      .send(body());
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(two.headers['idempotent-replayed']).toBe('true');
    expect(two.body.entries[0].id).toBe(one.body.entries[0].id);

    const found = await get('/entries?month=2026-10&q=Padaria');
    expect(found.body.entries).toHaveLength(1);
  });

  it('a mesma chave com outro conteúdo é recusada', async () => {
    await request(harness.app)
      .post('/api/finance/entries')
      .set('Idempotency-Key', 'k-2')
      .send(body());
    const other = await request(harness.app)
      .post('/api/finance/entries')
      .set('Idempotency-Key', 'k-2')
      .send({ ...body(), amount: '9.00' });
    expect(other.status).toBe(422);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('If-Match com versão velha dá 409 e a atual passa', async () => {
    const created = await send('post', '/entries', body());
    const entry = created.body.entries[0];
    const edited = { ...body(), amount: '9.50' };

    const stale = await request(harness.app)
      .put(`/api/finance/entries/${entry.id}`)
      .set('If-Match', '"7"')
      .send(edited);
    expect(stale.status).toBe(409);

    const fresh = await request(harness.app)
      .put(`/api/finance/entries/${entry.id}`)
      .set('If-Match', `"${entry.version}"`)
      .send(edited);
    expect(fresh.status).toBe(200);
    expect(fresh.body.entry.version).toBe(entry.version + 1);
  });

  it('duas edições concorrentes: uma vence, a outra recebe conflito', async () => {
    const created = await send('post', '/entries', body());
    const entry = created.body.entries[0];
    const put = (amount: string) =>
      request(harness.app)
        .put(`/api/finance/entries/${entry.id}`)
        .set('If-Match', `"${entry.version}"`)
        .send({ ...body(), amount });
    const [a, b] = await Promise.all([put('10.00'), put('11.00')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

describe('contas, transferências e faturas', () => {
  it('CE-08 · transferência move saldo entre contas e não vira receita nem despesa', async () => {
    const before = await get('/overview?month=2026-10');
    const response = await send('post', '/transfers', {
      from_account_id: ids['acc:Itaú Corrente'],
      to_account_id: ids['acc:Nubank Conta'],
      amount: '500.00',
      date: '2026-10-24',
    });
    expect(response.status).toBe(201);
    const after = await get('/overview?month=2026-10');
    expect(after.body.receitas.amount).toBe(before.body.receitas.amount);
    expect(after.body.despesas.amount).toBe(before.body.despesas.amount);
    expect(after.body.em_contas.amount).toBe(before.body.em_contas.amount);
  });

  it('extrato fecha: abertura + entradas − saídas = fechamento', async () => {
    const response = await get(
      `/accounts/${ids['acc:Itaú Corrente']}/statement?month=2026-10`,
    );
    expect(response.status).toBe(200);
    const { opening, entered, left, closing } = response.body;
    expect((Number(opening) + Number(entered) - Number(left)).toFixed(2)).toBe(
      Number(closing).toFixed(2),
    );
  });

  it('CE-09 · pagar fatura acima do em aberto é recusado; pagamento parcial reduz a fatura', async () => {
    const cards = await get('/cards');
    const summary = cards.body.cards.find(
      (c: { card: { id: string } }) => c.card.id === ids['card:Itaú Visa'],
    );
    const month = summary.invoice.month;
    const open = summary.used;

    const over = await send(
      'post',
      `/cards/${summary.card.id}/invoices/${month}/payments`,
      {
        date: '2026-10-24',
        amount: (Number(open) + 1).toFixed(2),
      },
    );
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('INVOICE_OVERPAYMENT');

    const partial = await send(
      'post',
      `/cards/${summary.card.id}/invoices/${month}/payments`,
      {
        date: '2026-10-24',
        amount: '100.00',
      },
    );
    expect(partial.status).toBe(201);
    const invoice = await get(`/cards/${summary.card.id}/invoices/${month}`);
    expect(invoice.body.payments).toHaveLength(1);
  });

  it('mover a compra para outra fatura muda só a fatura, não a data', async () => {
    const snap = await get('/snapshot');
    const entry = snap.body.entries.find(
      (e: { payments: { source_type: string; source_id: string }[]; status: string }) =>
        e.status === 'lancada' && e.payments.some((p) => p.source_type === 'cartao'),
    );
    const part = entry.payments.find(
      (p: { source_type: string }) => p.source_type === 'cartao',
    );
    const target = '2027-01';
    const moved = await send('post', `/entries/${entry.id}/invoice`, {
      invoice_month: target,
    });
    expect(moved.status).toBe(200);
    const after = await get('/snapshot');
    const next = after.body.entries.find((e: { id: string }) => e.id === entry.id);
    expect(next.date).toBe(entry.date);
    expect(
      next.payments.find((p: { source_type: string }) => p.source_type === 'cartao')
        .invoice_month,
    ).toBe(target);
    expect(part.invoice_month).not.toBe(target);
  });

  it('mover para fatura com pagamento é recusado', async () => {
    const snap = await get('/snapshot');
    const item = snap.body.card_items[0];
    const paid = snap.body.invoice_payments.find(
      (p: { card_id: string }) => p.card_id === item.card_id,
    );
    if (paid === undefined) return;
    const response = await send('post', `/card-items/${item.id}/invoice`, {
      invoice_month: paid.invoice_month,
    });
    expect(response.status).toBe(422);
  });

  it('estorno guarda de qual compra veio', async () => {
    const snap = await get('/snapshot');
    const entry = snap.body.entries.find(
      (e: { payments: { source_type: string; source_id: string }[]; status: string }) =>
        e.status === 'lancada' && e.payments.some((p) => p.source_type === 'cartao'),
    );
    const cardPart = entry.payments.find(
      (p: { source_type: string }) => p.source_type === 'cartao',
    );
    const month = cardPart.invoice_month;
    const cardId = cardPart.source_id;
    const created = await send('post', `/cards/${cardId}/items`, {
      kind: 'credito',
      subtype: 'estorno',
      invoice_month: month,
      description: `Estorno · ${entry.description}`,
      amount: '10.00',
      reverses_id: entry.id,
    });
    expect(created.status).toBe(201);
    const after = await get('/snapshot');
    expect(
      after.body.card_items.some(
        (i: { reverses_id: string | null }) => i.reverses_id === entry.id,
      ),
    ).toBe(true);
  });

  it('categoria em uso não é excluída (409 CATEGORY_IN_USE)', async () => {
    const response = await send('delete', `/categories/${ids['cat:Mercado']}`);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CATEGORY_IN_USE');
  });
});

describe('categorias: natureza e exclusão atômica (CAT-04)', () => {
  const usos = async (id: string) => {
    const [row] = await harness.sql<{ n: string }[]>`
      SELECT (
        (SELECT COUNT(*) FROM fin_entry WHERE category_id = ${id}) +
        (SELECT COUNT(*) FROM fin_recurring WHERE category_id = ${id})
      )::TEXT AS n`;
    return Number(row?.n);
  };

  it('excluir com move_to reatribui lançamentos e recorrentes e remove a categoria', async () => {
    const origem = ids['cat:Mercado'] as string;
    const destino = ids['cat:Restaurantes'] ?? ids['cat:Lazer'];
    expect(destino).toBeDefined();
    const antes = await usos(origem);
    const destinoAntes = await usos(destino as string);
    expect(antes).toBeGreaterThan(0);

    const response = await send('post', `/categories/${origem}/delete`, {
      move_to: destino,
    });
    expect(response.status).toBe(200);
    expect(await usos(destino as string)).toBe(destinoAntes + antes);
    const restantes = await harness.sql`SELECT id FROM fin_category WHERE id = ${origem}`;
    expect(restantes).toHaveLength(0);
  });

  it('destino de outro tipo é recusado e nada muda', async () => {
    const origem = ids['cat:Mercado'] as string;
    const receita = Object.entries(ids).find(([k]) => k === 'cat:Salário')?.[1];
    expect(receita).toBeDefined();
    const antes = await usos(origem);

    const response = await send('post', `/categories/${origem}/delete`, {
      move_to: receita,
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('CATEGORY_KIND_MISMATCH');
    expect(await usos(origem)).toBe(antes);
  });

  it('natureza só existe em despesa', async () => {
    const despesa = await send('post', '/categories', {
      name: 'Aluguel',
      kind: 'despesa',
      color: 'violet',
      nature: 'fixa',
    });
    expect(despesa.status).toBe(201);
    const [row] = await harness.sql<{ nature: string }[]>`
      SELECT nature FROM fin_category WHERE name = 'Aluguel'`;
    expect(row?.nature).toBe('FIXA');

    const receita = await send('post', '/categories', {
      name: 'Bônus',
      kind: 'receita',
      color: 'green',
      nature: 'livre',
    });
    expect(receita.status).toBe(422);
    expect(receita.body.code).toBe('CATEGORY_NATURE_INVALID');
  });
});

describe('recorrentes e rotina diária', () => {
  it('a rotina é idempotente: rodar duas vezes não duplica previstos', async () => {
    await send('post', '/jobs/sync');
    const first = await get('/entries?from=2026-01-01&to=2026-12-31&limit=200');
    await send('post', '/jobs/sync');
    const second = await get('/entries?from=2026-01-01&to=2026-12-31&limit=200');
    expect(second.body.total).toBe(first.body.total);
  });

  it('pular um mês remove o previsto e a rotina não o recria', async () => {
    const recurrings = await get('/recurrings');
    const target = recurrings.body.recurrings.find(
      (r: { name: string }) => r.name === 'Freela · Projeto Lume',
    );
    const month = '2026-10';
    await send('post', `/recurrings/${target.id}/skip`, { month });
    await send('post', '/jobs/sync');
    const found = await get(`/entries?month=${month}&q=Projeto%20Lume`);
    expect(
      found.body.entries.filter((e: { status: string }) => e.status === 'prevista'),
    ).toHaveLength(0);
  });
});

describe('busca e consistência (RN-70)', () => {
  it('acha por descrição e por valor', async () => {
    const byText = await get('/search?q=mercado');
    expect(byText.status).toBe(200);
    expect(byText.body.groups.length).toBeGreaterThan(0);
  });

  it('a soma por categoria é igual ao total de despesas da visão geral', async () => {
    const overview = await get('/overview?month=2026-10');
    const breakdown = await get(
      '/categories/breakdown?kind=despesa&from=2026-10-01&to=2026-10-31',
    );
    expect(breakdown.body.total).toBe(overview.body.despesas.amount);
    const tenths = breakdown.body.rows.reduce(
      (sum: number, row: { tenths: number }) => sum + row.tenths,
      0,
    );
    expect(tenths).toBe(1000);
  });
});

describe('orçamento de consultas', () => {
  it.each([
    '/finance/overview?month=2026-10',
    '/finance/entries?month=2026-10',
    '/finance/book?month=2026-10',
    '/finance/accounts',
    '/finance/cards',
    '/finance/categories',
    '/finance/search?q=mercado',
  ])('%s faz no máximo 2 consultas', async (path) => {
    const { result, count } = await harness.queryCounter.measure(() =>
      request(harness.app).get(`/api${path}`),
    );
    expect(result.status).toBe(200);
    expect(count.queries).toBeLessThanOrEqual(2);
  });
});

describe('patrimônio e livre após faturas (LIV-09)', () => {
  it('bate com o Em contas e com as faturas da Visão geral', async () => {
    const wealth = await get('/wealth');
    const overview = await get('/overview?month=2026-10');
    expect(wealth.status).toBe(200);
    expect(wealth.body.em_contas).toBe(overview.body.em_contas.amount);
    // A demonstração não tem carteira consolidada: patrimônio nulo, nunca zero.
    expect(wealth.body.em_carteiras).toBeNull();
    expect(wealth.body.patrimonio).toBeNull();
  });

  it('o livre e o que falta fecham com Em contas e o total devido', async () => {
    const { body } = await get('/wealth');
    const owed = Number(body.abertas) + Number(body.fechadas_a_pagar);
    expect(Number(body.total_devido)).toBeCloseTo(owed, 2);
    expect(Number(body.livre) - Number(body.falta) + owed).toBeCloseTo(
      Number(body.em_contas),
      2,
    );
  });
});

describe('livro unificado (LIV-02)', () => {
  it('os totais do mês batem com a Visão geral e não dependem da página', async () => {
    const overview = await get('/overview?month=2026-10');
    const full = await get('/book?month=2026-10&limit=200');
    const small = await get('/book?month=2026-10&limit=3');
    expect(full.status).toBe(200);
    expect(full.body.totals.receitas).toBe(overview.body.receitas.amount);
    expect(full.body.totals.despesas).toBe(overview.body.despesas.amount);
    expect(small.body.rows).toHaveLength(3);
    expect(small.body.totals).toEqual(full.body.totals);
    expect(small.body.count).toBe(full.body.count);
    expect(small.body.next_cursor).not.toBeNull();
  });

  it('filtra por tipo e agrupa por dia', async () => {
    const res = await get('/book?month=2026-10&tipo=DESPESA&groupBy=dia&limit=200');
    expect(res.status).toBe(200);
    expect(res.body.rows.every((r: { kind: string }) => r.kind === 'DESPESA')).toBe(true);
    const grouped = res.body.groups.reduce(
      (sum: number, g: { count: number }) => sum + g.count,
      0,
    );
    expect(grouped).toBe(res.body.count);
  });

  it('evento só aparece com o filtro de tipo Evento', async () => {
    const res = await get('/book?month=2026-10&limit=200');
    expect(res.body.rows.some((r: { kind: string }) => r.kind === 'EVENTO')).toBe(false);
  });

  it('recusa tipo desconhecido', async () => {
    expect((await get('/book?tipo=COMPRA')).status).toBe(400);
  });
});

describe('contas: no patrimônio e previsto de fim de mês (CTA-01, CTA-05)', () => {
  it('cada conta traz o previsto de fim de mês e o total fecha com a mesma função da Visão geral', async () => {
    const accounts = await get('/accounts');
    const overview = await get('/overview?month=2026-10');
    expect(accounts.status).toBe(200);
    for (const row of accounts.body.accounts) {
      expect(typeof row.projected_month_end).toBe('string');
      expect(typeof row.account.in_wealth).toBe('boolean');
    }
    expect(accounts.body.as_of).toBe('2026-10-24');
    expect(accounts.body.total_balance).toBe(overview.body.em_contas.amount);
  });

  it('desligar "no patrimônio" tira a conta de Em contas, sem tirar da lista', async () => {
    const before = await get('/accounts');
    const nubank = before.body.accounts.find(
      (a: { account: { name: string } }) => a.account.name === 'Nubank Conta',
    );
    const body = {
      name: nubank.account.name,
      type: nubank.account.type,
      institution: nubank.account.institution,
      role: nubank.account.role,
      role_tag: null,
      opening_amount: nubank.account.opening_amount,
      opening_date: nubank.account.opening_date,
      in_wealth: false,
    };
    const updated = await send('put', `/accounts/${nubank.account.id}`, body);
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const after = await get('/accounts');
    expect(after.body.accounts).toHaveLength(before.body.accounts.length);
    const dropped = Number(before.body.total_balance) - Number(after.body.total_balance);
    expect(dropped).toBeCloseTo(Number(nubank.balance), 2);
  });
});
