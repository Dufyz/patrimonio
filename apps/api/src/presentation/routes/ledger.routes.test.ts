import { loadFinanceDemo } from '@patrimonio/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/** 24/10/2026, 12h em São Paulo. */
const AGORA = new Date('2026-10-24T15:00:00.000Z');

let harness: ApiHarness;
let carteira: string;
let corretora: string;
let conta: string;
let cartao: string;

beforeAll(async () => {
  harness = await createApiHarness({
    clock: { now: () => AGORA, today: () => '2026-10-24' as never },
  });
});
afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);
  await loadFinanceDemo(harness.sql);
  const criada = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Longo prazo' });
  carteira = criada.body.portfolio.id;
  corretora = await seedInstitution(harness.sql, 'Corretora A');
  const [accounts, cards] = await Promise.all([
    request(harness.app).get('/api/finance/accounts'),
    request(harness.app).get('/api/finance/cards'),
  ]);
  conta = accounts.body.accounts[0].account.id;
  cartao = cards.body.cards[0].card.id;
});

const aportar = (body: Record<string, unknown> = {}, query = '', key?: string) => {
  const call = request(harness.app).post(`/api/ledger/aportes${query}`);
  if (key !== undefined) call.set('Idempotency-Key', key);
  return call.send({
    portfolio_id: carteira,
    institution_id: corretora,
    asset: { ticker: 'BOVA11', name: 'iShares Ibovespa', b3_type: 'etf' },
    trade_date: '2026-10-20',
    quantity: '10',
    unit_price: '100',
    fees: '5',
    account_id: conta,
    ...body,
  });
};

const saldo = async (): Promise<number> => {
  const response = await request(harness.app).get('/api/finance/accounts');
  const found = response.body.accounts.find(
    (a: { account: { id: string } }) => a.account.id === conta,
  );
  return Number(found.balance);
};

const contagem = async (sql: string): Promise<number> => {
  const [row] = await harness.sql.unsafe<{ n: string }[]>(sql);
  return Number(row?.n);
};

describe('aporte: conta → carteira (LIV-03)', () => {
  it('grava a compra e a saída da conta juntas, ligadas pelo event_id', async () => {
    const antes = await saldo();
    const response = await aportar();

    expect(response.status).toBe(201);
    expect(response.body.amount).toBe('1005.00');
    expect(response.body.account.before).toBeDefined();
    expect(await saldo()).toBeCloseTo(antes - 1005, 2);

    const [leg] = await harness.sql<{ event_id: string; kind: string; amount: string }[]>`
      SELECT event_id, kind, amount::TEXT FROM fin_movement WHERE kind = 'APORTE'`;
    const [tx] = await harness.sql<{ event_id: string }[]>`
      SELECT event_id FROM transaction WHERE kind = 'buy'`;
    expect(leg?.amount).toBe('-1005.00');
    expect(leg?.event_id).toBe(tx?.event_id);
    expect(response.body.event_id).toBe(tx?.event_id);
  });

  it('origem "Fora do app" grava só a perna de posição', async () => {
    const antes = await saldo();
    const response = await aportar({ account_id: null });
    expect(response.status).toBe(201);
    expect(response.body.account).toBeNull();
    expect(await saldo()).toBeCloseTo(antes, 2);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM fin_movement WHERE kind = 'APORTE'`),
    ).toBe(0);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM transaction WHERE kind = 'buy'`),
    ).toBe(1);
  });

  it('recusa origem em cartão com APORTE_ORIGEM_CARTAO e não grava nada', async () => {
    const response = await aportar({ account_id: cartao });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('APORTE_ORIGEM_CARTAO');
    expect(response.body.message).toMatch(/cartão/);
    expect(await contagem(`SELECT COUNT(*) AS n FROM transaction`)).toBe(0);
  });

  it('recusa data futura (RN-03)', async () => {
    const response = await aportar({ trade_date: '2026-10-25' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('DATA_FUTURA');
  });

  it('a mesma Idempotency-Key não duplica as duas pernas', async () => {
    const antes = await saldo();
    const first = await aportar({}, '', 'chave-aporte-1');
    const second = await aportar({}, '', 'chave-aporte-1');
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(await saldo()).toBeCloseTo(antes - 1005, 2);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM fin_movement WHERE kind = 'APORTE'`),
    ).toBe(1);
  });

  it('o preview devolve o efeito sem gravar e sem enfileirar', async () => {
    const outbox = () => contagem(`SELECT COUNT(*) AS n FROM pipeline_outbox`);
    const eventosAntes = await outbox();
    const antes = await saldo();
    const response = await aportar({}, '?preview=true');
    expect(response.status).toBe(200);
    expect(response.body.preview).toBe(true);
    expect(Number(response.body.account.after)).toBeCloseTo(
      Number(response.body.account.before) - 1005,
      2,
    );
    expect(response.body.position.avg_price.after).toBeDefined();
    expect(await saldo()).toBeCloseTo(antes, 2);
    expect(await contagem(`SELECT COUNT(*) AS n FROM transaction`)).toBe(0);
    expect(await outbox()).toBe(eventosAntes);
  });

  it('antes da abertura da conta o saldo não muda, e a posição sim', async () => {
    const response = await aportar({ trade_date: '2026-09-01' });
    expect(response.status).toBe(201);
    expect(response.body.account.after).toBe(response.body.account.before);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM transaction WHERE kind = 'buy'`),
    ).toBe(1);
  });

  it('enfileira o recálculo da carteira na mesma transação', async () => {
    const response = await aportar();
    expect(response.body.recalculation).not.toBeNull();
    expect(await contagem(`SELECT COUNT(*) AS n FROM pipeline_outbox`)).toBeGreaterThan(
      0,
    );
  });
});

const resgatar = (body: Record<string, unknown> = {}, query = '', key?: string) => {
  const call = request(harness.app).post(`/api/ledger/resgates${query}`);
  if (key !== undefined) call.set('Idempotency-Key', key);
  return call.send({
    portfolio_id: carteira,
    institution_id: corretora,
    asset_id: ativo,
    trade_date: '2026-10-22',
    quantity: '4',
    unit_price: '110',
    fees: '2',
    account_id: conta,
    ...body,
  });
};

let ativo: string;

describe('resgate: carteira → conta (LIV-04)', () => {
  beforeEach(async () => {
    const compra = await aportar({ account_id: null, trade_date: '2026-10-10' });
    ativo = compra.body.transaction.asset_id;
  });

  it('credita a conta e reduz a posição, ligados pelo event_id', async () => {
    const antes = await saldo();
    const response = await resgatar();

    expect(response.status).toBe(201);
    expect(response.body.amount).toBe('438.00');
    expect(await saldo()).toBeCloseTo(antes + 438, 2);

    const [leg] = await harness.sql<{ event_id: string; amount: string }[]>`
      SELECT event_id, amount::TEXT FROM fin_movement WHERE kind = 'RESGATE'`;
    const [tx] = await harness.sql<{ event_id: string }[]>`
      SELECT event_id FROM transaction WHERE kind = 'sell'`;
    expect(leg?.amount).toBe('438.00');
    expect(leg?.event_id).toBe(tx?.event_id);
    expect(response.body.event_id).toBe(tx?.event_id);
    expect(response.body.expense_id).toBeNull();
  });

  it('não entra como receita', async () => {
    const receitas = () =>
      contagem(`SELECT COUNT(*) AS n FROM fin_entry WHERE kind = 'RECEITA'`);
    const antes = await receitas();
    await resgatar();
    expect(await receitas()).toBe(antes);
  });

  it('recusa resgate acima da posição com RESGATE_ACIMA_DA_POSICAO', async () => {
    const response = await resgatar({ quantity: '11' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('RESGATE_ACIMA_DA_POSICAO');
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM transaction WHERE kind = 'sell'`),
    ).toBe(0);
  });

  it('com despesa ligada grava a despesa do mesmo dia e valor, com o mesmo event_id', async () => {
    const [categoria] = await harness.sql<{ id: string }[]>`
      SELECT id FROM fin_category WHERE kind = 'DESPESA' LIMIT 1`;
    const antes = await saldo();
    const response = await resgatar({
      linked_expense: { category_id: categoria?.id, description: 'Viagem' },
    });

    expect(response.status).toBe(201);
    expect(response.body.expense_id).not.toBeNull();
    const [entry] = await harness.sql<
      { event_id: string; amount: string; date: string }[]
    >`SELECT event_id, amount::TEXT, date::TEXT FROM fin_entry WHERE id = ${response.body.expense_id}`;
    expect(entry?.event_id).toBe(response.body.event_id);
    expect(Number(entry?.amount)).toBeCloseTo(438, 2);
    expect(entry?.date).toBe('2026-10-22');
    // o dinheiro entra e sai: o saldo da conta fica onde estava
    expect(await saldo()).toBeCloseTo(antes, 2);
  });

  it('o preview devolve o efeito sem gravar', async () => {
    const antes = await saldo();
    const response = await resgatar({}, '?preview=true');
    expect(response.status).toBe(200);
    expect(response.body.preview).toBe(true);
    expect(await saldo()).toBeCloseTo(antes, 2);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM transaction WHERE kind = 'sell'`),
    ).toBe(0);
  });

  it('a mesma Idempotency-Key não duplica as pernas', async () => {
    const antes = await saldo();
    const first = await resgatar({}, '', 'chave-resgate-1');
    const second = await resgatar({}, '', 'chave-resgate-1');
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await saldo()).toBeCloseTo(antes + 438, 2);
  });

  it('exige conta para gerar a despesa ligada', async () => {
    const response = await resgatar({
      account_id: null,
      linked_expense: { category_id: '00000000-0000-4000-8000-000000000001' },
    });
    expect(response.status).toBe(400);
  });
});

const provento = (body: Record<string, unknown> = {}) =>
  request(harness.app)
    .post('/api/transactions/payouts')
    .send({
      portfolio_id: carteira,
      institution_id: corretora,
      asset_id: ativo,
      payout_kind: 'dividend',
      record_date: '2026-10-15',
      payment_date: '2026-10-20',
      amount_per_share: '0.5',
      account_id: conta,
      ...body,
    });

describe('provento creditado na conta (LIV-05)', () => {
  beforeEach(async () => {
    const compra = await aportar({ account_id: null, trade_date: '2026-10-10' });
    ativo = compra.body.transaction.asset_id;
  });

  it('credita o líquido na conta, ligado ao provento pelo event_id, e não vira receita', async () => {
    const antes = await saldo();
    const receitas = await contagem(
      `SELECT COUNT(*) AS n FROM fin_entry WHERE kind = 'RECEITA'`,
    );
    const response = await provento();

    expect(response.status).toBe(201);
    expect(await saldo()).toBeCloseTo(antes + 5, 2);
    expect(response.body.account.before).toBeDefined();
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM fin_entry WHERE kind = 'RECEITA'`),
    ).toBe(receitas);

    const [leg] = await harness.sql<{ event_id: string; amount: string }[]>`
      SELECT event_id, amount::TEXT FROM fin_movement WHERE kind = 'PROVENTO'`;
    expect(leg?.amount).toBe('5.00');
    expect(leg?.event_id).toBe(response.body.transaction.event_id);
  });

  it('"Fora do app" (sem conta) grava só a perna de posição', async () => {
    const antes = await saldo();
    const response = await provento({ account_id: null });
    expect(response.status).toBe(201);
    expect(response.body.account).toBeNull();
    expect(await saldo()).toBeCloseTo(antes, 2);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM fin_movement WHERE kind = 'PROVENTO'`),
    ).toBe(0);
  });

  it('o provento a receber só credita a conta quando é confirmado', async () => {
    const antes = await saldo();
    const response = await provento({ payment_date: '2026-11-05' });
    expect(response.status).toBe(201);
    expect(response.body.transaction.confirmed_at).toBeNull();
    expect(await saldo()).toBeCloseTo(antes, 2);

    const confirmado = await request(harness.app)
      .post(`/api/transactions/${response.body.transaction.id}/confirm`)
      .send({ net_amount: '4.50' });
    expect(confirmado.status).toBe(200);
    expect(confirmado.body.account).not.toBeNull();
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM fin_movement WHERE kind = 'PROVENTO'`),
    ).toBe(1);
  });

  it('recusa cartão como destino e não grava nada', async () => {
    const response = await provento({ account_id: cartao });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('PROVENTO_DESTINO_CARTAO');
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM "transaction" WHERE kind = 'payout'`),
    ).toBe(0);
  });
});

describe('evento no livro (LIV-06)', () => {
  const livro = (query: string) =>
    request(harness.app).get(`/api/finance/book?month=2026-10&limit=200${query}`);

  it('desdobramento não muda o custo total, não move dinheiro e só aparece com o filtro Evento', async () => {
    const compra = await aportar({ account_id: conta, trade_date: '2026-10-10' });
    const ativoId = compra.body.transaction.asset_id as string;

    const registrado = await request(harness.app).post('/api/corporate-events').send({
      asset_id: ativoId,
      kind: 'split',
      record_date: '2026-10-15',
      ratio_from: '1',
      ratio_to: '2',
    });
    expect(registrado.status).toBe(201);
    const antes = await saldo();
    const movimentos = await contagem(`SELECT COUNT(*) AS n FROM fin_movement`);
    const confirmado = await request(harness.app).post(
      `/api/corporate-events/${registrado.body.event.id}/confirm`,
    );
    expect(confirmado.status).toBe(200);

    // nenhum dinheiro se moveu
    expect(await saldo()).toBeCloseTo(antes, 2);
    expect(await contagem(`SELECT COUNT(*) AS n FROM fin_movement`)).toBe(movimentos);

    // o custo total da posição é o mesmo: 10 a 100,50 → 20 a 50,25
    const preview = await request(harness.app).post('/api/transactions/preview').send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretora,
      asset_id: ativoId,
      trade_date: '2026-10-24',
      quantity: '0',
      unit_price: '0',
      fees: '0',
    });
    expect(Number(preview.body.preview.position.cost_basis.before)).toBeCloseTo(1005, 2);
    expect(Number(preview.body.preview.position.quantity.before)).toBeCloseTo(20, 4);

    const padrao = await livro('');
    const tipos = (padrao.body.rows as { kind: string }[]).map((r) => r.kind);
    expect(tipos).not.toContain('EVENTO');

    const soEvento = await livro('&tipo=EVENTO');
    const eventos = (soEvento.body.rows as { kind: string }[]).map((r) => r.kind);
    expect(eventos.length).toBeGreaterThan(0);
    expect(new Set(eventos)).toEqual(new Set(['EVENTO']));
  });
});
