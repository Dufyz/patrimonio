import {
  transactionPreviewSchema,
  transactionResourceSchema,
} from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

let harness: ApiHarness;
let carteira: string;
let corretora: string;

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);

  const criada = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Longo prazo' });
  carteira = criada.body.portfolio.id;
  corretora = await seedInstitution(harness.sql, 'Corretora A', { brokerage: '4.90' });
});

const lancar = (body: Record<string, unknown>) =>
  request(harness.app)
    .post('/api/transactions')
    .send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretora,
      asset: { ticker: 'ITUB4', name: 'Itaú Unibanco PN', b3_type: 'stock' },
      trade_date: '2026-10-06',
      quantity: '100',
      unit_price: '36.84',
      ...body,
    });

const preview = (body: Record<string, unknown>) =>
  request(harness.app)
    .post('/api/transactions/preview')
    .send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretora,
      asset: { ticker: 'ITUB4', name: 'Itaú Unibanco PN', b3_type: 'stock' },
      trade_date: '2026-10-06',
      quantity: '100',
      unit_price: '36.84',
      ...body,
    });

describe('compra', () => {
  it('cria o ativo no primeiro lançamento, sem cadastro prévio', async () => {
    const response = await lancar({});

    expect(response.status).toBe(201);
    const transaction = transactionResourceSchema.parse(response.body.transaction);
    expect(transaction.asset_id).not.toBeNull();

    const ativos = await request(harness.app).get('/api/assets?search=ITUB4');
    expect(ativos.body.assets).toHaveLength(1);
    expect(ativos.body.assets[0].origin).toBe('market');
  });

  it('o valor bruto e o líquido são calculados, não digitados', async () => {
    const response = await lancar({ fees: '4.90' });

    expect(response.body.transaction.gross_amount).toBe('3684.00');
    // Comprar tira dinheiro, e a taxa sai junto.
    expect(response.body.transaction.net_amount).toBe('-3688.90');
  });

  it('a taxa vem da regra da instituição quando não é informada', async () => {
    const response = await lancar({});

    expect(response.body.transaction.fees).toBe('4.90');
  });

  it('a taxa informada no corpo sobrescreve a sugestão', async () => {
    const response = await lancar({ fees: '0' });

    expect(response.body.transaction.fees).toBe('0.00');
  });

  it('a liquidação de ação é sugerida em D+2 dias úteis', async () => {
    // 2026-10-06 é uma terça-feira: D+2 cai na quinta.
    const response = await lancar({});

    expect(response.body.transaction.settlement_date).toBe('2026-10-08');
  });

  it('a liquidação informada no corpo vence a sugestão', async () => {
    const response = await lancar({ settlement_date: '2026-10-09' });

    expect(response.body.transaction.settlement_date).toBe('2026-10-09');
  });

  it('liquidação antes da operação é recusada', async () => {
    const response = await lancar({ settlement_date: '2026-10-01' });

    expect(response.status).toBe(400);
  });

  it('o lançamento enfileira o recálculo da carteira a partir da data dele', async () => {
    const response = await lancar({});

    expect(response.body.recalculation.dedupe_key).toBe(`recalc:${carteira}`);
    expect(response.body.recalculation.already_queued).toBe(false);

    const [evento] = await harness.sql<{ from_date: string; stage: string }[]>`
      SELECT stage, payload ->> 'from_date' AS from_date
        FROM pipeline_outbox WHERE stage = 'recalc'
    `;
    expect(evento?.from_date).toBe('2026-10-06');
  });

  it('cinco lançamentos seguidos na mesma carteira viram um recálculo', async () => {
    await lancar({});
    await lancar({ trade_date: '2026-10-05' });
    await lancar({ trade_date: '2026-10-02' });

    const [recalcs] = await harness.sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM pipeline_outbox WHERE stage = 'recalc'
    `;
    expect(Number(recalcs?.total)).toBe(1);

    // E o from_date recua para a data mais antiga pedida na rajada.
    const [evento] = await harness.sql<{ from_date: string }[]>`
      SELECT payload ->> 'from_date' AS from_date
        FROM pipeline_outbox WHERE stage = 'recalc'
    `;
    expect(evento?.from_date).toBe('2026-10-02');
  });

  it('o primeiro lançamento de um ativo novo pede também o backfill do preço', async () => {
    await lancar({});

    const [backfills] = await harness.sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total
        FROM pipeline_outbox WHERE dedupe_key LIKE 'backfill:%'
    `;
    expect(Number(backfills?.total)).toBe(1);
  });

  it('lançar numa carteira arquivada é recusado', async () => {
    await request(harness.app)
      .post(`/api/portfolios/${carteira}/archive`)
      .send({ archived: true });

    const response = await lancar({});

    expect(response.status).toBe(409);
  });
});

describe('venda', () => {
  it('venda acima da quantidade disponível é recusada, e a mensagem diz quanto há', async () => {
    await lancar({});

    const response = await lancar({ kind: 'sell', quantity: '150' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/100/);
  });

  it('venda dentro da posição grava e devolve o resultado realizado', async () => {
    await lancar({ fees: '0' });

    const response = await lancar({
      kind: 'sell',
      quantity: '40',
      unit_price: '45.00',
      fees: '0',
    });

    expect(response.status).toBe(201);
    // 40 × 45 = 1.800 recebidos; custo consumido 40 × 36,84 = 1.473,60.
    expect(response.body.preview.realized_result).toBe('326.40');
    expect(response.body.transaction.net_amount).toBe('1800.00');
  });
});

describe('preview', () => {
  it('mostra quantidade, preço médio, peso e caixa antes e depois', async () => {
    await lancar({ fees: '0' });

    const response = await preview({ quantity: '100', unit_price: '40.00', fees: '0' });

    expect(response.status).toBe(200);
    const body = transactionPreviewSchema.parse(response.body.preview);
    expect(body.position.quantity.before).toBe('100.00000000');
    expect(body.position.quantity.after).toBe('200.00000000');
    expect(body.position.avg_price.after).toBe('38.42000000');
    expect(body.cash.after).toBe('-7684.00');
  });

  it('o preview não grava nada: nem o lançamento, nem o ativo novo', async () => {
    const response = await preview({
      asset: { ticker: 'TAEE11', name: 'Taesa Unit', b3_type: 'stock' },
    });

    expect(response.status).toBe(200);
    expect(response.body.preview.position.quantity.before).toBe('0.00000000');

    const ativos = await request(harness.app).get('/api/assets?search=TAEE11');
    const lancamentos = await request(harness.app).get('/api/transactions');
    expect(ativos.body.assets).toHaveLength(0);
    expect(lancamentos.body.total).toBe(0);
  });

  it('os números do preview são os mesmos que ficam gravados', async () => {
    const antes = await preview({ fees: '0' });
    const gravado = await lancar({ fees: '0' });

    expect(gravado.body.preview.position).toEqual(antes.body.preview.position);
    expect(gravado.body.preview.cash).toEqual(antes.body.preview.cash);
    expect(gravado.body.preview.total_amount).toBe(antes.body.preview.total_amount);
  });
});

describe('extrato', () => {
  it('filtra por tipo, período e carteira', async () => {
    await lancar({ trade_date: '2026-09-01' });
    await lancar({ trade_date: '2026-10-06' });
    await lancar({ kind: 'sell', quantity: '50', trade_date: '2026-10-06' });

    const compras = await request(harness.app).get('/api/transactions?kind=buy');
    const outubro = await request(harness.app).get(
      '/api/transactions?from=2026-10-01&to=2026-10-31',
    );

    expect(compras.body.total).toBe(2);
    expect(outubro.body.total).toBe(2);
    expect(outubro.body.page).toBe(1);
  });
});
