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
let itub4: string;

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
  corretora = await seedInstitution(harness.sql, 'Corretora A');

  const compra = await request(harness.app)
    .post('/api/transactions')
    .send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretora,
      asset: { ticker: 'ITUB4', name: 'Itaú Unibanco PN', b3_type: 'stock' },
      trade_date: '2026-06-10',
      quantity: '500',
      unit_price: '29.10',
      fees: '0',
    });
  itub4 = compra.body.transaction.asset_id;
});

const lancarProvento = (body: Record<string, unknown>) =>
  request(harness.app)
    .post('/api/transactions/payouts')
    .send({
      portfolio_id: carteira,
      institution_id: corretora,
      asset_id: itub4,
      payout_kind: 'dividend',
      record_date: '2026-09-30',
      payment_date: '2026-10-20',
      amount_per_share: '0.22616',
      ...body,
    });

describe('provento', () => {
  it('a quantidade na data-com é calculada pelos lançamentos, não digitada', async () => {
    const response = await lancarProvento({});

    expect(response.status).toBe(201);
    expect(response.body.quantity_at_record_date).toBe('500.00000000');
    // 500 × 0,22616 = 113,08
    expect(response.body.transaction.gross_amount).toBe('113.08');
  });

  it('uma compra posterior à data-com não aumenta o provento', async () => {
    await request(harness.app).post('/api/transactions').send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretora,
      asset_id: itub4,
      trade_date: '2026-10-05',
      quantity: '500',
      unit_price: '31.00',
      fees: '0',
    });

    const response = await lancarProvento({});

    expect(response.body.quantity_at_record_date).toBe('500.00000000');
  });

  it('JCP calcula o líquido a partir do bruto com IR de 15%', async () => {
    const response = await lancarProvento({ payout_kind: 'jcp' });

    expect(response.body.transaction.tax_withheld).toBe('16.96');
    expect(response.body.transaction.net_amount).toBe('96.12');
  });

  it('dividendo não tem IR retido', async () => {
    const response = await lancarProvento({});

    expect(response.body.transaction.tax_withheld).toBe('0.00');
    expect(response.body.transaction.net_amount).toBe('113.08');
  });

  it('o IR retido informado no corpo vence o cálculo', async () => {
    const response = await lancarProvento({ payout_kind: 'jcp', tax_withheld: '10.00' });

    expect(response.body.transaction.tax_withheld).toBe('10.00');
  });

  it('provento com pagamento futuro fica a receber', async () => {
    const response = await lancarProvento({ payment_date: '2099-10-20' });

    expect(response.body.transaction.confirmed_at).toBeNull();
    expect(response.body.message).toMatch(/a receber/);

    const pendentes = await request(harness.app).get(
      '/api/transactions?pending_payouts=true',
    );
    expect(pendentes.body.total).toBe(1);
  });

  it('provento já pago entra confirmado', async () => {
    const response = await lancarProvento({ payment_date: '2026-07-20' });

    expect(response.body.transaction.confirmed_at).not.toBeNull();
  });

  it('amortização reduz o custo da posição em vez de contar como rendimento', async () => {
    const response = await lancarProvento({
      payout_kind: 'amortization',
      amount_per_share: '2.00',
    });

    // 500 × 29,10 = 14.550 de custo; a amortização de 1.000 derruba para 13.550.
    expect(response.body.preview.position.cost_basis.before).toBe('14550.00');
    expect(response.body.preview.position.cost_basis.after).toBe('13550.00');
  });

  it('valor bruto total também é aceito, e o valor por ação sai dele', async () => {
    const response = await lancarProvento({
      amount_per_share: undefined,
      gross_amount: '113.08',
    });

    expect(response.body.transaction.gross_amount).toBe('113.08');
    expect(Number(response.body.transaction.unit_price)).toBeCloseTo(0.22616, 5);
  });

  it('sem posição na data-com, o provento é recusado', async () => {
    const response = await lancarProvento({ record_date: '2026-01-05' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/posição/);
  });

  it('pagamento antes da data-com é recusado', async () => {
    const response = await lancarProvento({
      record_date: '2026-09-30',
      payment_date: '2026-09-01',
    });

    expect(response.status).toBe(400);
  });

  it('o provento enfileira recálculo a partir da data-com', async () => {
    const response = await lancarProvento({});

    expect(response.body.recalculation.dedupe_key).toBe(`recalc:${carteira}`);
  });
});

describe('confirmação de recebimento', () => {
  it('o provento a receber vira recebido quando o dinheiro entra', async () => {
    const criado = await lancarProvento({ payment_date: '2099-10-20' });

    const response = await request(harness.app)
      .post(`/api/transactions/${criado.body.transaction.id}/confirm`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.transaction.confirmed_at).not.toBeNull();
    expect(response.body.difference).toBeNull();
  });

  it('o valor recebido pode diferir do previsto, e a diferença fica registrada', async () => {
    const criado = await lancarProvento({ payment_date: '2099-10-20' });

    const response = await request(harness.app)
      .post(`/api/transactions/${criado.body.transaction.id}/confirm`)
      .send({ net_amount: '110.00' });

    expect(response.body.transaction.net_amount).toBe('110.00');
    expect(response.body.expected_net_amount).toBe('113.08');
    expect(response.body.difference).toBe('-3.08');
  });

  it('confirmar duas vezes é recusado', async () => {
    const criado = await lancarProvento({ payment_date: '2099-10-20' });
    const url = `/api/transactions/${criado.body.transaction.id}/confirm`;

    await request(harness.app).post(url).send({});
    const segunda = await request(harness.app).post(url).send({});

    expect(segunda.status).toBe(409);
  });

  it('confirmar enfileira recálculo da carteira', async () => {
    const criado = await lancarProvento({ payment_date: '2099-10-20' });

    const response = await request(harness.app)
      .post(`/api/transactions/${criado.body.transaction.id}/confirm`)
      .send({});

    expect(response.body.recalculation.dedupe_key).toBe(`recalc:${carteira}`);
  });
});

describe('provento que não foi pago', () => {
  it('sai do livro e o motivo fica registrado', async () => {
    const criado = await lancarProvento({ payment_date: '2099-10-20' });

    const response = await request(harness.app)
      .post(`/api/transactions/${criado.body.transaction.id}/dismiss`)
      .send({ reason: 'A empresa cancelou o pagamento' });

    expect(response.status).toBe(200);
    expect(response.body.dismissal.reason).toBe('A empresa cancelou o pagamento');
    expect(response.body.dismissal.expected_net_amount).toBe('113.08');

    const extrato = await request(harness.app).get('/api/transactions?kind=payout');
    expect(extrato.body.total).toBe(0);
  });

  it('provento já recebido não é marcado como não pago', async () => {
    const criado = await lancarProvento({ payment_date: '2026-07-20' });

    const response = await request(harness.app)
      .post(`/api/transactions/${criado.body.transaction.id}/dismiss`)
      .send({ reason: 'Enganei-me' });

    expect(response.status).toBe(400);
  });

  it('sem motivo não é aceito', async () => {
    const criado = await lancarProvento({ payment_date: '2099-10-20' });

    const response = await request(harness.app)
      .post(`/api/transactions/${criado.body.transaction.id}/dismiss`)
      .send({ reason: '' });

    expect(response.status).toBe(400);
  });
});
