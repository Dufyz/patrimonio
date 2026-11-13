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

describe('preview unificado: o efeito é o que a gravação grava (LIV-07)', () => {
  beforeEach(async () => {
    const compra = await aportar({ account_id: null, trade_date: '2026-10-10' });
    ativo = compra.body.transaction.asset_id;
  });

  it('aporte: conta e posição do preview são os da gravação', async () => {
    const preview = await aportar({ asset: undefined, asset_id: ativo }, '?preview=true');
    const gravado = await aportar({ asset: undefined, asset_id: ativo });
    expect(preview.status).toBe(200);
    expect(gravado.status).toBe(201);
    expect(gravado.body.account).toEqual(preview.body.account);
    expect(gravado.body.position).toEqual(preview.body.position);
    expect(gravado.body.amount).toBe(preview.body.amount);
  });

  it('resgate: conta e posição do preview são os da gravação', async () => {
    const preview = await resgatar({}, '?preview=true');
    const gravado = await resgatar();
    expect(gravado.body.account).toEqual(preview.body.account);
    expect(gravado.body.position).toEqual(preview.body.position);
    expect(gravado.body.amount).toBe(preview.body.amount);
  });

  it('provento: o efeito na conta do preview é o da gravação', async () => {
    const corpo = {
      portfolio_id: carteira,
      institution_id: corretora,
      asset_id: ativo,
      payout_kind: 'dividend',
      record_date: '2026-10-15',
      payment_date: '2026-10-20',
      amount_per_share: '0.5',
      account_id: conta,
    };
    const preview = await request(harness.app)
      .post('/api/transactions/payouts/preview')
      .send(corpo);
    const gravado = await provento();
    expect(preview.status).toBe(200);
    expect(gravado.body.account).toEqual(preview.body.account);
  });

  it('o preview recusa com o mesmo código da gravação', async () => {
    const cartaoPreview = await aportar({ account_id: cartao }, '?preview=true');
    expect(cartaoPreview.status).toBe(422);
    expect(cartaoPreview.body.code).toBe('APORTE_ORIGEM_CARTAO');

    const acima = await resgatar({ quantity: '11' }, '?preview=true');
    expect(acima.status).toBe(422);
    expect(acima.body.code).toBe('RESGATE_ACIMA_DA_POSICAO');
  });
});

describe('invariante da cota: a origem não muda o fluxo de capital (LIV-14)', () => {
  it('o aporte de conta e o de fora do app gravam a mesma linha de posição', async () => {
    const colunas = `kind, trade_date, quantity, unit_price, fees, gross_amount, net_amount`;
    const deConta = await aportar({ account_id: conta });
    expect(deConta.status).toBe(201);
    const [a] = await harness.sql.unsafe<Record<string, string>[]>(
      `SELECT ${colunas} FROM "transaction" WHERE kind = 'buy'`,
    );
    await harness.sql`DELETE FROM "transaction"`;

    const deFora = await aportar({ account_id: null });
    expect(deFora.status).toBe(201);
    const [b] = await harness.sql.unsafe<Record<string, string>[]>(
      `SELECT ${colunas} FROM "transaction" WHERE kind = 'buy'`,
    );

    expect(b).toEqual(a);
  });
});

describe('excluir lançamento de carteira com as duas pernas (LIV-12)', () => {
  const excluir = (id: string, query = '') =>
    request(harness.app).delete(`/api/transactions/${id}${query}`);

  it('excluir um aporte devolve o valor à conta e tira a quantidade, e o desfazer restaura tudo', async () => {
    const antes = await saldo();
    const aporte = await aportar();
    expect(await saldo()).toBeCloseTo(antes - 1005, 2);

    const removido = await excluir(aporte.body.transaction.id);
    expect(removido.status).toBe(200);
    expect(await saldo()).toBeCloseTo(antes, 2);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM "transaction" WHERE kind = 'buy'`),
    ).toBe(0);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM fin_movement WHERE kind = 'APORTE'`),
    ).toBe(0);

    const desfeito = await request(harness.app).post(
      `/api/transactions/undo/${removido.body.undo.undo_id}`,
    );
    expect(desfeito.status).toBe(200);
    expect(await saldo()).toBeCloseTo(antes - 1005, 2);
    const [leg] = await harness.sql<{ event_id: string }[]>`
      SELECT event_id FROM fin_movement WHERE kind = 'APORTE'`;
    const [tx] = await harness.sql<{ event_id: string }[]>`
      SELECT event_id FROM "transaction" WHERE kind = 'buy'`;
    expect(leg?.event_id).toBe(tx?.event_id);
  });

  it('recusa excluir um aporte que deixaria a posição negativa, com a data do primeiro dia afetado', async () => {
    const compra = await aportar({ account_id: null, trade_date: '2026-10-10' });
    ativo = compra.body.transaction.asset_id;
    const venda = await resgatar({ trade_date: '2026-10-12' });
    expect(venda.status).toBe(201);

    const response = await excluir(compra.body.transaction.id);
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('POSICAO_NEGATIVA');
    expect(response.body.message).toMatch(/2026-10-12/);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM "transaction" WHERE kind = 'buy'`),
    ).toBe(1);
  });

  it('excluir resgate com despesa ligada pergunta pelo outro lançamento', async () => {
    const compra = await aportar({ account_id: null, trade_date: '2026-10-10' });
    ativo = compra.body.transaction.asset_id;
    const [categoria] = await harness.sql<{ id: string }[]>`
      SELECT id FROM fin_category WHERE kind = 'DESPESA' LIMIT 1`;
    const antes = await saldo();
    const venda = await resgatar({
      linked_expense: { category_id: categoria?.id, description: 'Viagem' },
    });
    const id = venda.body.transaction.id as string;

    const semEscolha = await excluir(id);
    expect(semEscolha.status).toBe(409);
    expect(semEscolha.body.code).toBe('DESPESA_LIGADA_DECISAO');

    const manter = await excluir(id, '?despesa_ligada=manter');
    expect(manter.status).toBe(200);
    expect(
      await contagem(
        `SELECT COUNT(*) AS n FROM fin_entry WHERE id = '${venda.body.expense_id}'`,
      ),
    ).toBe(1);
    // o resgate saiu, a despesa ficou: o saldo cai pela despesa
    expect(await saldo()).toBeCloseTo(antes - 438, 2);
  });

  it('excluir o resgate junto da despesa devolve o saldo ao que era', async () => {
    const compra = await aportar({ account_id: null, trade_date: '2026-10-10' });
    ativo = compra.body.transaction.asset_id;
    const [categoria] = await harness.sql<{ id: string }[]>`
      SELECT id FROM fin_category WHERE kind = 'DESPESA' LIMIT 1`;
    const antes = await saldo();
    const venda = await resgatar({ linked_expense: { category_id: categoria?.id } });

    const response = await excluir(venda.body.transaction.id, '?despesa_ligada=excluir');
    expect(response.status).toBe(200);
    expect(await saldo()).toBeCloseTo(antes, 2);
    expect(
      await contagem(
        `SELECT COUNT(*) AS n FROM fin_entry WHERE id = '${venda.body.expense_id}'`,
      ),
    ).toBe(0);
  });
});

describe('editar lançamento de carteira com as duas pernas (LIV-12)', () => {
  const editar = (id: string, body: Record<string, unknown>, ifMatch?: string) => {
    const call = request(harness.app).patch(`/api/transactions/${id}`);
    if (ifMatch !== undefined) call.set('If-Match', ifMatch);
    return call.send(body);
  };

  it('editar o valor do aporte recalcula o saldo da conta e a posição', async () => {
    const antes = await saldo();
    const aporte = await aportar();
    const id = aporte.body.transaction.id as string;

    const response = await editar(
      id,
      { quantity: '20' },
      aporte.body.transaction.updated_at,
    );
    expect(response.status).toBe(200);
    // 20 × 100 + 5 de taxa
    expect(await saldo()).toBeCloseTo(antes - 2005, 2);
    const [leg] = await harness.sql<{ amount: string }[]>`
      SELECT amount::TEXT FROM fin_movement WHERE kind = 'APORTE'`;
    expect(leg?.amount).toBe('-2005.00');
  });

  it('trocar a origem para "Fora do app" apaga a perna e devolve o saldo', async () => {
    const antes = await saldo();
    const aporte = await aportar();
    const response = await editar(
      aporte.body.transaction.id,
      { account_id: null },
      aporte.body.transaction.updated_at,
    );
    expect(response.status).toBe(200);
    expect(await saldo()).toBeCloseTo(antes, 2);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM fin_movement WHERE kind = 'APORTE'`),
    ).toBe(0);
  });

  it('escolher uma conta onde não havia nenhuma cria a perna ligada', async () => {
    const antes = await saldo();
    const aporte = await aportar({ account_id: null });
    const response = await editar(
      aporte.body.transaction.id,
      { account_id: conta },
      aporte.body.transaction.updated_at,
    );
    expect(response.status).toBe(200);
    expect(await saldo()).toBeCloseTo(antes - 1005, 2);
    const [leg] = await harness.sql<{ event_id: string }[]>`
      SELECT event_id FROM fin_movement WHERE kind = 'APORTE'`;
    const [tx] = await harness.sql<{ event_id: string }[]>`
      SELECT event_id FROM "transaction" WHERE kind = 'buy'`;
    expect(leg?.event_id).toBe(tx?.event_id);
  });

  it('exige If-Match, e a versão velha devolve 409 com o estado atual', async () => {
    const aporte = await aportar();
    const id = aporte.body.transaction.id as string;

    const sem = await editar(id, { quantity: '12' });
    expect(sem.status).toBe(428);
    expect(sem.body.code).toBe('IF_MATCH_OBRIGATORIO');

    const primeira = await editar(
      id,
      { quantity: '12' },
      aporte.body.transaction.updated_at,
    );
    expect(primeira.status).toBe(200);

    const velha = await editar(
      id,
      { quantity: '13' },
      aporte.body.transaction.updated_at,
    );
    expect(velha.status).toBe(409);
    expect(velha.body.code).toBe('VERSAO_DIVERGENTE');
    expect(velha.body.details.current).toBeDefined();
  });

  it('editar o resgate move a despesa ligada junto', async () => {
    const compra = await aportar({ account_id: null, trade_date: '2026-10-10' });
    ativo = compra.body.transaction.asset_id;
    const [categoria] = await harness.sql<{ id: string }[]>`
      SELECT id FROM fin_category WHERE kind = 'DESPESA' LIMIT 1`;
    const venda = await resgatar({ linked_expense: { category_id: categoria?.id } });

    const response = await editar(
      venda.body.transaction.id,
      { quantity: '5' },
      venda.body.transaction.updated_at,
    );
    expect(response.status).toBe(200);
    const [entry] = await harness.sql<{ amount: string }[]>`
      SELECT amount::TEXT FROM fin_entry WHERE id = ${venda.body.expense_id}`;
    const [leg] = await harness.sql<{ amount: string }[]>`
      SELECT amount::TEXT FROM fin_movement WHERE kind = 'RESGATE'`;
    expect(entry?.amount).toBe(leg?.amount);
  });
});

describe('aporte recorrente e previstos de aporte (LIV-11)', () => {
  const criar = (body: Record<string, unknown> = {}) =>
    request(harness.app)
      .post('/api/finance/recurrings')
      .send({
        name: 'Aporte mensal',
        kind: 'aporte',
        portfolio_id: carteira,
        source: { type: 'conta', id: conta },
        day: 28,
        mode: 'manual',
        amount: '500.00',
        ...body,
      });
  const previsao = (date: string) =>
    request(harness.app).get(`/api/finance/forecast?date=${date}`);

  it('o recorrente de aporte não gera lançamento previsto, mas reduz o saldo previsto', async () => {
    const sem = await previsao('2026-10-31');
    const entradas = await contagem(`SELECT COUNT(*) AS n FROM fin_entry`);

    const criado = await criar();
    expect(criado.status).toBe(201);
    expect(await contagem(`SELECT COUNT(*) AS n FROM fin_entry`)).toBe(entradas);

    const com = await previsao('2026-10-31');
    expect(Number(sem.body.balance) - Number(com.body.balance)).toBeCloseTo(500, 2);
    expect(com.body.planned_aportes).toHaveLength(1);
    // antes do dia 28 o previsto ainda não vence
    const antes = await previsao('2026-10-27');
    expect(antes.body.planned_aportes).toHaveLength(0);
  });

  it('VGR-04 · a previsão traz as linhas que compõem o saldo e elas fecham', async () => {
    await criar();
    const res = await previsao('2026-10-31');
    const { parts, balance } = res.body;
    expect(parts.aportes).toBe('500.00');
    const soma =
      Number(parts.em_contas) +
      Number(parts.entradas) -
      Number(parts.saidas) -
      Number(parts.aportes) -
      Number(parts.faturas);
    expect(soma).toBeCloseTo(Number(balance), 2);
    expect(parts.saldo).toBe(balance);
  });

  it('o previsto de aporte não entra em Aportes do livro', async () => {
    await criar();
    const livro = await request(harness.app).get(
      '/api/finance/book?month=2026-10&limit=200',
    );
    expect(livro.body.totals.aportes).toBe('0.00');
  });

  it('recusa origem em cartão e modo automático', async () => {
    const cartaoOrigem = await criar({ source: { type: 'cartao', id: cartao } });
    expect(cartaoOrigem.status).toBe(422);
    expect(cartaoOrigem.body.code).toBe('APORTE_ORIGEM_CARTAO');

    const automatico = await criar({ mode: 'automatico' });
    expect(automatico.status).toBe(422);
    expect(automatico.body.code).toBe('RECURRING_APORTE_MODE');
  });

  it('lançar o aporte com recurring_id faz o previsto do mês sumir', async () => {
    const criado = await criar();
    expect(criado.status).toBe(201);
    const [linha] = await harness.sql<{ id: string }[]>`
      SELECT id FROM fin_recurring WHERE kind = 'APORTE'`;
    const recorrente = linha?.id;
    expect(recorrente).toBeDefined();

    const lancado = await aportar({ recurring_id: recorrente, trade_date: '2026-10-24' });
    expect(lancado.status).toBe(201);

    const depois = await previsao('2026-10-31');
    expect(depois.body.planned_aportes).toHaveLength(0);
  });

  it('recurring_id inexistente é recusado', async () => {
    const response = await aportar({
      recurring_id: '00000000-0000-4000-8000-000000000009',
    });
    expect(response.status).toBe(404);
    expect(await contagem(`SELECT COUNT(*) AS n FROM "transaction"`)).toBe(0);
  });
});

describe('carteiras: excluir com pernas e reordenar (CFG-05)', () => {
  const excluirCarteira = (id: string, nome: string, ifMatch?: string) => {
    const call = request(harness.app).delete(`/api/portfolios/${id}`);
    if (ifMatch !== undefined) call.set('If-Match', ifMatch);
    return call.send({ confirm_name: nome, transactions: 'delete' });
  };

  it('excluir carteira com aportes de conta exige If-Match e devolve o valor às contas', async () => {
    const antes = await saldo();
    await aportar();
    expect(await saldo()).toBeCloseTo(antes - 1005, 2);

    const outra = await request(harness.app)
      .post('/api/portfolios')
      .send({ name: 'Reserva' });

    const semHeader = await excluirCarteira(carteira, 'Longo prazo');
    expect(semHeader.status).toBe(428);

    const divergente = await excluirCarteira(
      carteira,
      'Longo prazo',
      '2000-01-01T00:00:00.000Z',
    );
    expect(divergente.status).toBe(409);

    const atual = await request(harness.app).get(`/api/portfolios/${carteira}`);
    const versao = atual.body.portfolio.updated_at as string;

    const ok = await excluirCarteira(carteira, 'Longo prazo', `"${versao}"`);
    expect(ok.status).toBe(200);
    expect(await saldo()).toBeCloseTo(antes, 2);
    expect(await contagem(`SELECT COUNT(*) AS n FROM "transaction"`)).toBe(0);
    expect(
      await contagem(`SELECT COUNT(*) AS n FROM fin_movement WHERE kind = 'APORTE'`),
    ).toBe(0);
    // A outra carteira não foi tocada.
    const lista = await request(harness.app).get('/api/portfolios');
    expect(lista.body.portfolios.map((p: { id: string }) => p.id)).toContain(
      outra.body.portfolio.id,
    );
  });

  it('reordenar grava a ordem da lista e recusa id repetido ou inexistente', async () => {
    const b = await request(harness.app).post('/api/portfolios').send({ name: 'B' });
    const c = await request(harness.app).post('/api/portfolios').send({ name: 'C' });
    const ids = [c.body.portfolio.id, carteira, b.body.portfolio.id];

    const ok = await request(harness.app).put('/api/portfolios/order').send({ ids });
    expect(ok.status).toBe(200);
    const lista = await request(harness.app).get('/api/portfolios');
    expect(lista.body.portfolios.map((p: { id: string }) => p.id)).toEqual(ids);

    const repetido = await request(harness.app)
      .put('/api/portfolios/order')
      .send({ ids: [carteira, carteira] });
    expect(repetido.status).toBe(400);

    const inexistente = await request(harness.app)
      .put('/api/portfolios/order')
      .send({ ids: [carteira, '00000000-0000-4000-8000-000000000000'] });
    expect(inexistente.status).toBe(400);
  });
});
