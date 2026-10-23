import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

let harness: ApiHarness;
let itau: string;
let carteira: string;

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);
  itau = await seedInstitution(harness.sql, 'Itaú');

  const criada = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Reserva' });
  carteira = criada.body.portfolio.id;

  // CDI constante de 0,04% ao dia útil em todo o primeiro semestre de 2024.
  await harness.sql`
    INSERT INTO index_quote (index_code, quote_date, daily_factor, source)
    SELECT 'CDI', calendar_date, 1.0004, 'teste'
      FROM business_day
     WHERE is_business_day
       AND calendar_date BETWEEN '2024-01-01' AND '2024-06-30'
  `;
});

const cadastrarCaixinha = (body: Record<string, unknown> = {}) =>
  request(harness.app)
    .post('/api/assets')
    .send({
      origin: 'manual',
      kind: 'cdb',
      issuer_id: itau,
      indexer: 'cdi_pct',
      rate: '100',
      issued_at: '2024-01-02',
      liquidity: 'daily',
      tax_regime: 'regressive',
      redemption_rule: 'oldest_first',
      ...body,
    });

const aportar = (
  assetId: string,
  tradeDate: string,
  amount: string,
  extra: Record<string, unknown> = {},
) =>
  request(harness.app)
    .post('/api/transactions')
    .send({
      ...extra,
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: itau,
      asset_id: assetId,
      trade_date: tradeDate,
      quantity: amount,
      unit_price: '1',
    });

const base = (assetId: string) => `/api/portfolios/${carteira}/assets/${assetId}`;

const caixinhaComDoisAportes = async (): Promise<string> => {
  const criada = await cadastrarCaixinha();
  const id = criada.body.asset.id as string;

  expect((await aportar(id, '2024-01-02', '1000')).status).toBe(201);
  expect((await aportar(id, '2024-02-01', '500')).status).toBe(201);

  return id;
};

describe('cadastro da caixinha', () => {
  it('nasce sem vencimento, com liquidez diária e a regra de resgate gravada', async () => {
    const response = await cadastrarCaixinha();

    expect(response.status).toBe(201);
    expect(response.body.asset.redemption_rule).toBe('oldest_first');
    expect(response.body.asset.maturity_date).toBeNull();
    expect(response.body.asset.name).toBe('Caixinha Itaú · 100% CDI');
    expect(response.body.asset.ticker).toMatch(/-CAIXINHA$/);
  });

  it('liquidez no vencimento sem nenhum vencimento é recusada', async () => {
    const response = await cadastrarCaixinha({ liquidity: 'at_maturity' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/vencimento/);
  });

  it('vencer como um todo e ter prazo por lote são escolhas excludentes', async () => {
    const response = await cadastrarCaixinha({
      maturity_date: '2024-12-31',
      lot_term_months: 12,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Escolha/);
  });

  it('título comum continua exigindo o vencimento', async () => {
    const response = await cadastrarCaixinha({ redemption_rule: undefined });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/vencimento/);
  });
});

describe('lotes da caixinha', () => {
  it('cada aporte é um lote com a própria data e o rendimento do próprio prazo', async () => {
    const id = await caixinhaComDoisAportes();

    const response = await request(harness.app).get(
      `${base(id)}/caixinha?as_of=2024-03-01`,
    );

    expect(response.status).toBe(200);
    expect(response.body.redemption_rule).toBe('oldest_first');
    expect(response.body.lots).toHaveLength(2);
    expect(
      response.body.lots.map((lot: { trade_date: string }) => lot.trade_date),
    ).toEqual(['2024-01-02', '2024-02-01']);

    const [antigo, novo] = response.body.lots;
    expect(antigo.elapsed_days).toBe(59);
    expect(novo.elapsed_days).toBe(29);
    expect(Number(antigo.accrued_interest)).toBeGreaterThan(
      Number(novo.accrued_interest),
    );
    expect(Number(novo.gross_value)).toBeGreaterThan(500);
    expect(response.body.principal).toBe('1500.00');
  });

  it('ativo que não é caixinha é recusado', async () => {
    const comum = await cadastrarCaixinha({
      redemption_rule: undefined,
      maturity_date: '2028-01-02',
      liquidity: 'at_maturity',
    });

    const response = await request(harness.app).get(
      `${base(comum.body.asset.id)}/caixinha?as_of=2024-03-01`,
    );

    expect(response.status).toBe(400);
  });
});

describe('resgate da caixinha', () => {
  it('a prévia mostra o lote mais antigo sendo consumido primeiro, com o IR dele', async () => {
    const id = await caixinhaComDoisAportes();

    const response = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions/preview`)
      .send({ trade_date: '2024-03-01', amount: '300.00' });

    expect(response.status).toBe(200);
    expect(response.body.insufficient).toBe(false);
    expect(response.body.slices).toHaveLength(1);
    expect(response.body.slices[0].trade_date).toBe('2024-01-02');
    expect(response.body.slices[0].closes_lot).toBe(false);
    expect(response.body.gross_value).toBe('300.00');
    expect(Number(response.body.tax_due)).toBeGreaterThan(0);
    expect(Number(response.body.net_value)).toBe(
      Number(response.body.gross_value) - Number(response.body.tax_due),
    );
  });

  it('a prévia não grava nada', async () => {
    const id = await caixinhaComDoisAportes();

    await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions/preview`)
      .send({ trade_date: '2024-03-01', amount: '300.00' });

    const [count] = await harness.sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM transaction WHERE kind = 'sell'
    `;
    expect(count?.total).toBe('0');
  });

  it('registrar o resgate grava uma venda e reduz o lote consumido', async () => {
    const id = await caixinhaComDoisAportes();

    const antes = await request(harness.app).get(`${base(id)}/caixinha?as_of=2024-03-01`);

    const response = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions`)
      .send({ trade_date: '2024-03-01', amount: '300.00' });

    expect(response.status).toBe(201);
    expect(response.body.transaction.kind).toBe('sell');
    expect(response.body.transaction.gross_amount).toBe('300.00');
    expect(response.body.transaction.net_amount).toBe(response.body.redemption.net_value);
    expect(response.body.recalculation.dedupe_key).toBe(`recalc:${carteira}`);

    const depois = await request(harness.app).get(
      `${base(id)}/caixinha?as_of=2024-03-01`,
    );

    expect(depois.body.lots).toHaveLength(2);
    expect(depois.body.lots[1].remaining).toBe(antes.body.lots[1].remaining);
    expect(Number(depois.body.lots[0].remaining)).toBeLessThan(
      Number(antes.body.lots[0].remaining),
    );
    expect(Number(depois.body.gross_value)).toBeCloseTo(
      Number(antes.body.gross_value) - 300,
      2,
    );
  });

  it('resgatar tudo do lote antigo e um pouco do novo deixa só o lote novo parcial', async () => {
    const id = await caixinhaComDoisAportes();

    const total = await request(harness.app).get(`${base(id)}/caixinha?as_of=2024-03-01`);
    const antigo = Number(total.body.lots[0].gross_value);

    const response = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions`)
      .send({
        institution_id: itau,
        trade_date: '2024-03-01',
        amount: (antigo + 100).toFixed(2),
      });

    expect(response.status).toBe(201);
    expect(response.body.redemption.slices).toHaveLength(2);
    expect(response.body.redemption.slices[0].closes_lot).toBe(true);

    const depois = await request(harness.app).get(
      `${base(id)}/caixinha?as_of=2024-03-01`,
    );
    expect(depois.body.lots).toHaveLength(1);
    expect(depois.body.lots[0].trade_date).toBe('2024-02-01');
  });

  it('pedir mais do que a caixinha vale é recusado e não grava', async () => {
    const id = await caixinhaComDoisAportes();

    const response = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions`)
      .send({ trade_date: '2024-03-01', amount: '5000.00' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/disponíveis/);

    const [count] = await harness.sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM transaction WHERE kind = 'sell'
    `;
    expect(count?.total).toBe('0');
  });

  it('a mesma Idempotency-Key não resgata duas vezes', async () => {
    const id = await caixinhaComDoisAportes();
    const enviar = () =>
      request(harness.app)
        .post(`${base(id)}/caixinha/redemptions`)
        .set('Idempotency-Key', 'resgate-1')
        .send({ trade_date: '2024-03-01', amount: '300.00' });

    const primeiro = await enviar();
    const segundo = await enviar();

    expect(primeiro.status).toBe(201);
    expect(segundo.status).toBe(200);
    expect(segundo.body.transaction.id).toBe(primeiro.body.transaction.id);
  });

  it('com a regra do mais novo primeiro o lote de fevereiro é o consumido', async () => {
    const criada = await cadastrarCaixinha({ redemption_rule: 'newest_first' });
    const id = criada.body.asset.id as string;
    await aportar(id, '2024-01-02', '1000');
    await aportar(id, '2024-02-01', '500');

    const response = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions/preview`)
      .send({ trade_date: '2024-03-01', amount: '200.00' });

    expect(response.body.slices[0].trade_date).toBe('2024-02-01');
  });
});

describe('lançamento comum numa caixinha', () => {
  it('aporte digitado como quantidade × preço é gravado em valor, com o mesmo total', async () => {
    const criada = await cadastrarCaixinha();

    const response = await request(harness.app).post('/api/transactions').send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: itau,
      asset_id: criada.body.asset.id,
      trade_date: '2024-01-02',
      quantity: '1',
      unit_price: '1000',
    });

    // Quantidade × preço é o valor do aporte: R$ 1.000,00, gravado em valor.
    expect(response.status).toBe(201);
    expect(response.body.transaction.quantity).toBe('1000.00000000');
    expect(response.body.transaction.unit_price).toBe('1.00000000');
  });

  it('venda comum é recusada: a retirada é um resgate', async () => {
    const id = await caixinhaComDoisAportes();

    const response = await request(harness.app).post('/api/transactions').send({
      kind: 'sell',
      portfolio_id: carteira,
      institution_id: itau,
      asset_id: id,
      trade_date: '2024-03-01',
      quantity: '100',
      unit_price: '1',
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/resgate/);
  });
});

describe('editar o ativo para caixinha', () => {
  const comum = () =>
    cadastrarCaixinha({
      redemption_rule: undefined,
      maturity_date: '2028-01-02',
      liquidity: 'at_maturity',
    });

  it('título sem lançamento vira caixinha: perde o vencimento e passa a ter liquidez diária', async () => {
    const criado = await comum();

    const response = await request(harness.app)
      .patch(`/api/assets/${criado.body.asset.id}`)
      .send({
        redemption_rule: 'oldest_first',
        maturity_date: null,
        liquidity: 'daily',
        liquidity_days: null,
      });

    expect(response.status).toBe(200);
    expect(response.body.asset.redemption_rule).toBe('oldest_first');
    expect(response.body.asset.maturity_date).toBeNull();
  });

  it('título com lançamento não vira caixinha: a quantidade passaria a valer outra coisa', async () => {
    const criado = await comum();
    await request(harness.app).post('/api/transactions').send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: itau,
      asset_id: criado.body.asset.id,
      trade_date: '2024-01-02',
      quantity: '1',
      unit_price: '1000',
    });

    const response = await request(harness.app)
      .patch(`/api/assets/${criado.body.asset.id}`)
      .send({
        redemption_rule: 'oldest_first',
        maturity_date: null,
        liquidity: 'daily',
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/lançamento/);
  });

  it('caixinha com lançamento muda a regra de resgate sem exigir vencimento', async () => {
    const id = await caixinhaComDoisAportes();

    const response = await request(harness.app)
      .patch(`/api/assets/${id}`)
      .send({ redemption_rule: 'newest_first', name: 'Reserva de emergência' });

    expect(response.status).toBe(200);
    expect(response.body.asset.redemption_rule).toBe('newest_first');
  });
});

describe('caixinha que vence como um todo', () => {
  const nubank = async () => {
    const criada = await cadastrarCaixinha({
      liquidity: 'at_maturity',
      maturity_date: '2024-05-31',
    });
    const id = criada.body.asset.id as string;
    await aportar(id, '2024-01-02', '1000');
    await aportar(id, '2024-02-01', '500');
    return id;
  };

  it('os lotes herdam o vencimento da caixinha', async () => {
    const id = await nubank();

    const response = await request(harness.app).get(
      `${base(id)}/caixinha?as_of=2024-03-01`,
    );

    expect(
      response.body.lots.map((lot: { maturity_date: string }) => lot.maturity_date),
    ).toEqual(['2024-05-31', '2024-05-31']);
    expect(response.body.lots[0].redeemable).toBe(false);
  });

  it('não dá para aportar depois do vencimento', async () => {
    const id = await nubank();

    const response = await aportar(id, '2024-06-03', '100');

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/venceu/);
  });

  it('antes do vencimento o resgate é recusado: nada está disponível', async () => {
    const id = await nubank();

    const response = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions`)
      .send({ trade_date: '2024-05-15', amount: '100.00' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/0\.00 disponíveis/);
  });

  it('no vencimento o resgate passa, e o lote vencido para de render', async () => {
    const id = await nubank();

    const noDia = await request(harness.app).get(`${base(id)}/caixinha?as_of=2024-05-31`);
    const depois = await request(harness.app).get(
      `${base(id)}/caixinha?as_of=2024-06-14`,
    );

    expect(depois.body.lots[0].gross_value).toBe(noDia.body.lots[0].gross_value);

    const resgate = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions`)
      .send({ trade_date: '2024-06-14', amount: '100.00' });

    expect(resgate.status).toBe(201);
  });
});

describe('caixinha que não vence mas cujos lotes vencem', () => {
  const itauCincoAnos = async () => {
    const criada = await cadastrarCaixinha({
      liquidity: 'at_maturity',
      lot_term_months: 1,
    });
    const id = criada.body.asset.id as string;
    await aportar(id, '2024-01-02', '1000');
    await aportar(id, '2024-02-01', '500');
    return id;
  };

  it('o aporte ganha o vencimento pelo prazo padrão da caixinha', async () => {
    const id = await itauCincoAnos();

    const response = await request(harness.app).get(
      `${base(id)}/caixinha?as_of=2024-02-15`,
    );

    expect(
      response.body.lots.map((lot: { maturity_date: string }) => lot.maturity_date),
    ).toEqual(['2024-02-02', '2024-03-01']);
    expect(
      response.body.lots.map((lot: { redeemable: boolean }) => lot.redeemable),
    ).toEqual([true, false]);
  });

  it('o vencimento informado no aporte vence o prazo padrão', async () => {
    const criada = await cadastrarCaixinha({
      liquidity: 'at_maturity',
      lot_term_months: 1,
    });
    const id = criada.body.asset.id as string;
    await aportar(id, '2024-01-02', '1000', { maturity_date: '2024-04-15' });

    const response = await request(harness.app).get(
      `${base(id)}/caixinha?as_of=2024-03-01`,
    );

    expect(response.body.lots[0].maturity_date).toBe('2024-04-15');
  });

  it('o resgate só alcança o lote que já venceu', async () => {
    const id = await itauCincoAnos();

    const alcanca = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions/preview`)
      .send({ trade_date: '2024-02-15', amount: '300.00' });
    const passa = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions/preview`)
      .send({ trade_date: '2024-02-15', amount: '1200.00' });

    expect(alcanca.body.insufficient).toBe(false);
    expect(
      alcanca.body.slices.map((slice: { lot_id: string }) => slice.lot_id),
    ).toHaveLength(1);
    expect(passa.body.insufficient).toBe(true);
    expect(Number(passa.body.available_gross)).toBeLessThan(1100);
  });

  it('vencimento do lote antes do aporte é recusado', async () => {
    const criada = await cadastrarCaixinha({
      liquidity: 'at_maturity',
      lot_term_months: 1,
    });

    const response = await aportar(criada.body.asset.id, '2024-02-01', '100', {
      maturity_date: '2024-01-15',
    });

    expect(response.status).toBe(400);
  });
});

describe('editar a caixinha pela tela', () => {
  it('troca nome e prazo dos lotes com o mesmo corpo que o formulário envia', async () => {
    const criada = await cadastrarCaixinha({ lot_term_months: 12 });
    const id = criada.body.asset.id as string;

    const response = await request(harness.app).patch(`/api/assets/${id}`).send({
      ticker: criada.body.asset.ticker,
      name: 'Reserva de emergência',
      sector: null,
      category_id: null,
      issuer_id: itau,
      indexer: 'cdi_pct',
      rate: '100',
      issued_at: '2024-01-02',
      redemption_rule: 'oldest_first',
      liquidity: 'daily',
      liquidity_days: null,
      maturity_date: null,
      lot_term_months: 60,
      tax_regime: 'regressive',
    });

    expect(response.status).toBe(200);
    expect(response.body.asset.name).toBe('Reserva de emergência');
    expect(response.body.asset.lot_term_months).toBe(60);
  });

  it('aceita o código gerado de 22 caracteres ao editar só o nome', async () => {
    const criada = await cadastrarCaixinha({ lot_term_months: 12 });
    const id = criada.body.asset.id as string;

    const response = await request(harness.app)
      .patch(`/api/assets/${id}`)
      .send({ ticker: 'CDB-NUPAGAME--CAIXINHA', name: 'Caixinha Turbo Nubank' });

    expect(response.status).toBe(200);
    expect(response.body.asset.ticker).toBe('CDB-NUPAGAME--CAIXINHA');
  });

  it('virar caixinha de lotes que vencem dá vencimento aos aportes que já existiam', async () => {
    const criada = await cadastrarCaixinha();
    const id = criada.body.asset.id as string;
    await aportar(id, '2024-01-02', '1000');
    await aportar(id, '2024-02-01', '500');

    const antes = await request(harness.app).get(`${base(id)}/caixinha?as_of=2024-02-15`);
    expect(
      antes.body.lots.map((lot: { maturity_date: string | null }) => lot.maturity_date),
    ).toEqual([null, null]);

    const editada = await request(harness.app)
      .patch(`/api/assets/${id}`)
      .send({ lot_term_months: 1 });
    expect(editada.status).toBe(200);

    const depois = await request(harness.app).get(
      `${base(id)}/caixinha?as_of=2024-02-15`,
    );
    expect(
      depois.body.lots.map((lot: { maturity_date: string | null }) => lot.maturity_date),
    ).toEqual(['2024-02-02', '2024-03-01']);
  });

  it('trocar o emissor leva as operações da caixinha para a nova instituição', async () => {
    const nubank = await seedInstitution(harness.sql, 'Nubank');
    const id = await caixinhaComDoisAportes();

    const editada = await request(harness.app)
      .patch(`/api/assets/${id}`)
      .send({ issuer_id: nubank });
    expect(editada.status).toBe(200);

    const instituicoes = await harness.sql<{ institution_id: string }[]>`
      SELECT DISTINCT institution_id FROM transaction WHERE asset_id = ${id}
    `;
    expect(instituicoes.map((row) => row.institution_id)).toEqual([nubank]);
  });

  it('o aporte com liquidação posterior só pode ser resgatado depois dela', async () => {
    const criada = await cadastrarCaixinha();
    const id = criada.body.asset.id as string;
    await aportar(id, '2024-01-02', '1000', { settlement_date: '2024-01-03' });

    const noDia = await request(harness.app).get(`${base(id)}/caixinha?as_of=2024-01-02`);
    expect(noDia.body.lots[0].settlement_date).toBe('2024-01-03');
    expect(noDia.body.lots[0].settled).toBe(false);
    expect(noDia.body.lots[0].redeemable).toBe(false);
    expect(Number(noDia.body.gross_value)).toBeGreaterThan(0);

    const resgateNoDia = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions/preview`)
      .send({ trade_date: '2024-01-02', amount: '100.00' });
    expect(resgateNoDia.body.insufficient).toBe(true);

    const resgateNoDiaSeguinte = await request(harness.app)
      .post(`${base(id)}/caixinha/redemptions/preview`)
      .send({ trade_date: '2024-01-03', amount: '100.00' });
    expect(resgateNoDiaSeguinte.body.insufficient).toBe(false);
  });
});
