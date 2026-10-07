import { deletionImpactSchema } from '@patrimonio/contracts';
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
let compraId: string;
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
      trade_date: '2021-03-12',
      quantity: '100',
      unit_price: '31.40',
      fees: '0',
    });

  compraId = compra.body.transaction.id;
  itub4 = compra.body.transaction.asset_id;

  // A rajada do cadastro vira um recálculo só; limpar aqui deixa cada teste
  // olhando apenas o evento que ele mesmo produziu.
  await harness.sql`delete from pipeline_outbox`;
});

describe('editar lançamento', () => {
  it('o preview da edição mostra o antes sem aquela linha e o depois com ela', async () => {
    const response = await request(harness.app)
      .post(`/api/transactions/${compraId}/preview`)
      .send({ unit_price: '31.04' });

    expect(response.status).toBe(200);
    expect(response.body.preview.position.quantity.before).toBe('0.00000000');
    expect(response.body.preview.position.avg_price.after).toBe('31.04000000');
  });

  it('os números do preview são os que ficam gravados', async () => {
    const antes = await request(harness.app)
      .post(`/api/transactions/${compraId}/preview`)
      .send({ unit_price: '31.04' });

    const salvo = await request(harness.app)
      .patch(`/api/transactions/${compraId}`)
      .send({ unit_price: '31.04' });

    expect(salvo.status).toBe(200);
    expect(salvo.body.preview.position).toEqual(antes.body.preview.position);
    expect(salvo.body.transaction.unit_price).toBe('31.04000000');
    expect(salvo.body.transaction.gross_amount).toBe('3104.00');
    expect(salvo.body.transaction.net_amount).toBe('-3104.00');
  });

  it('editar um lançamento de 2021 pede recálculo a partir daquela data', async () => {
    const response = await request(harness.app)
      .patch(`/api/transactions/${compraId}`)
      .send({ unit_price: '31.04' });

    expect(response.body.recalculation[0].dedupe_key).toBe(`recalc:${carteira}`);

    const [evento] = await harness.sql<{ from_date: string }[]>`
      select payload ->> 'from_date' as from_date
        from pipeline_outbox where stage = 'recalc'
    `;
    expect(evento?.from_date).toBe('2021-03-12');
  });

  it('mudar a data para trás recua o recálculo para a data mais antiga', async () => {
    await request(harness.app)
      .patch(`/api/transactions/${compraId}`)
      .send({ trade_date: '2019-05-02' });

    const [evento] = await harness.sql<{ from_date: string }[]>`
      select payload ->> 'from_date' as from_date
        from pipeline_outbox where stage = 'recalc'
    `;
    expect(evento?.from_date).toBe('2019-05-02');
  });

  it('edição que deixaria a posição negativa é recusada', async () => {
    const venda = await request(harness.app).post('/api/transactions').send({
      kind: 'sell',
      portfolio_id: carteira,
      institution_id: corretora,
      asset_id: itub4,
      trade_date: '2026-10-06',
      quantity: '50',
      unit_price: '36.00',
      fees: '0',
    });

    const response = await request(harness.app)
      .patch(`/api/transactions/${venda.body.transaction.id}`)
      .send({ quantity: '500' });

    expect(response.status).toBe(400);
  });

  it('lançamento inexistente devolve 404', async () => {
    const response = await request(harness.app)
      .patch('/api/transactions/0b4cf1d2-9b3a-4f4e-9f1a-000000000000')
      .send({ fees: '1' });

    expect(response.status).toBe(404);
  });
});

describe('excluir com desfazer', () => {
  it('a exclusão mostra o impacto nos números antes de sumir com a linha', async () => {
    const response = await request(harness.app).delete(`/api/transactions/${compraId}`);

    expect(response.status).toBe(200);
    const impact = deletionImpactSchema.parse(response.body.impact);
    expect(impact.position.quantity.before).toBe('100.00000000');
    expect(impact.position.quantity.after).toBe('0.00000000');
    expect(impact.cash.before).toBe('-3140.00');
    expect(impact.cash.after).toBe('0.00');
  });

  it('a linha some do livro e o desfazer vem com prazo', async () => {
    const response = await request(harness.app).delete(`/api/transactions/${compraId}`);

    expect(response.body.undo.undo_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(response.body.undo.expires_at).getTime()).toBeGreaterThan(Date.now());

    const extrato = await request(harness.app).get('/api/transactions');
    expect(extrato.body.total).toBe(0);
  });

  it('o desfazer restaura o estado anterior, com o mesmo id', async () => {
    const excluido = await request(harness.app).delete(`/api/transactions/${compraId}`);

    const desfeito = await request(harness.app)
      .post(`/api/transactions/undo/${excluido.body.undo.undo_id}`)
      .send({});

    expect(desfeito.status).toBe(200);
    expect(desfeito.body.transactions[0].id).toBe(compraId);

    const extrato = await request(harness.app).get('/api/transactions');
    expect(extrato.body.total).toBe(1);
  });

  it('o desfazer pede o recálculo de novo', async () => {
    const excluido = await request(harness.app).delete(`/api/transactions/${compraId}`);
    await harness.sql`delete from pipeline_outbox`;

    const desfeito = await request(harness.app)
      .post(`/api/transactions/undo/${excluido.body.undo.undo_id}`)
      .send({});

    expect(desfeito.body.recalculation[0].dedupe_key).toBe(`recalc:${carteira}`);
  });

  it('desfazer duas vezes não duplica o lançamento', async () => {
    const excluido = await request(harness.app).delete(`/api/transactions/${compraId}`);
    const url = `/api/transactions/undo/${excluido.body.undo.undo_id}`;

    await request(harness.app).post(url).send({});
    const segunda = await request(harness.app).post(url).send({});

    expect(segunda.status).toBe(404);

    const extrato = await request(harness.app).get('/api/transactions');
    expect(extrato.body.total).toBe(1);
  });

  it('a janela fechada recusa o desfazer', async () => {
    const excluido = await request(harness.app).delete(`/api/transactions/${compraId}`);

    await harness.sql`
      update transaction_undo set expires_at = now() - interval '1 minute'
       where id = ${excluido.body.undo.undo_id}
    `;

    const resposta = await request(harness.app)
      .post(`/api/transactions/undo/${excluido.body.undo.undo_id}`)
      .send({});

    expect(resposta.status).toBe(409);
  });

  it('excluir uma perna de transferência leva as duas, e o desfazer traz as duas', async () => {
    const outra = await request(harness.app)
      .post('/api/portfolios')
      .send({ name: 'Curto prazo' });

    const movida = await request(harness.app).post('/api/transactions/transfer').send({
      from_portfolio_id: carteira,
      to_portfolio_id: outra.body.portfolio.id,
      asset_id: itub4,
      institution_id: corretora,
      trade_date: '2026-10-06',
      quantity: '40',
    });

    const perna = movida.body.transactions[0].id;
    const excluido = await request(harness.app).delete(`/api/transactions/${perna}`);

    expect(excluido.body.deleted).toHaveLength(2);

    const desfeito = await request(harness.app)
      .post(`/api/transactions/undo/${excluido.body.undo.undo_id}`)
      .send({});

    expect(desfeito.body.transactions).toHaveLength(2);
  });
});
