import { transferPreviewSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

let harness: ApiHarness;
let longoPrazo: string;
let curtoPrazo: string;
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

  const primeira = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Longo prazo' });
  const segunda = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Curto prazo' });

  longoPrazo = primeira.body.portfolio.id;
  curtoPrazo = segunda.body.portfolio.id;
  corretora = await seedInstitution(harness.sql, 'Corretora A');

  const compra = await request(harness.app)
    .post('/api/transactions')
    .send({
      kind: 'buy',
      portfolio_id: longoPrazo,
      institution_id: corretora,
      asset: { ticker: 'ITUB4', name: 'Itaú Unibanco PN', b3_type: 'stock' },
      trade_date: '2026-06-10',
      quantity: '500',
      unit_price: '29.10',
      fees: '0',
    });
  itub4 = compra.body.transaction.asset_id;
});

const transferir = (body: Record<string, unknown>) =>
  request(harness.app)
    .post('/api/transactions/transfer')
    .send({
      from_portfolio_id: longoPrazo,
      to_portfolio_id: curtoPrazo,
      asset_id: itub4,
      institution_id: corretora,
      trade_date: '2026-10-06',
      quantity: '100',
      ...body,
    });

describe('transferência entre carteiras', () => {
  it('as duas pernas nascem juntas, ligadas pelo mesmo grupo', async () => {
    const response = await transferir({});

    expect(response.status).toBe(201);
    expect(response.body.transactions).toHaveLength(2);

    const [saida, entrada] = response.body.transactions as {
      portfolio_id: string;
      net_amount: string;
      transfer_group_id: string;
      kind: string;
    }[];

    expect(saida?.transfer_group_id).toBe(entrada?.transfer_group_id);
    expect(saida?.kind).toBe('transfer');
    expect(Number(saida?.net_amount) + Number(entrada?.net_amount)).toBe(0);
  });

  it('o preço médio é preservado nas duas pontas', async () => {
    const response = await transferir({});

    const preview = transferPreviewSchema.parse(response.body.preview);
    expect(preview.avg_price).toBe('29.10000000');
    expect(preview.origin.avg_price.after).toBe('29.10000000');
    expect(preview.destination.avg_price.after).toBe('29.10000000');
  });

  it('não gera resultado realizado: é reclassificação, não venda', async () => {
    await transferir({});

    const vendas = await request(harness.app).get('/api/transactions?kind=sell');
    expect(vendas.body.total).toBe(0);
  });

  it('o patrimônio total não muda, e o preview mostra isso', async () => {
    const response = await transferir({});

    expect(response.body.preview.total_change).toBe('0.00');
    expect(response.body.preview.total.before).toBe(response.body.preview.total.after);
  });

  it('a origem perde o custo que a posição levou', async () => {
    const response = await transferir({});

    // 100 cotas a 29,10: 2.910 saem de uma carteira e entram na outra.
    expect(response.body.preview.origin.cost_basis.before).toBe('14550.00');
    expect(response.body.preview.origin.cost_basis.after).toBe('11640.00');
    expect(response.body.preview.destination.cost_basis.after).toBe('2910.00');
  });

  it('mover tudo não exige digitar a quantidade', async () => {
    const response = await transferir({ quantity: undefined, all: true });

    expect(response.status).toBe(201);
    expect(response.body.preview.origin.quantity.after).toBe('0.00000000');
    expect(response.body.preview.destination.quantity.after).toBe('500.00000000');
  });

  it('mover mais do que a origem tem é recusado', async () => {
    const response = await transferir({ quantity: '900' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/500/);
  });

  it('as duas carteiras ganham recálculo a partir da data', async () => {
    const response = await transferir({});

    const chaves = (response.body.recalculation as { dedupe_key: string }[]).map(
      (event) => event.dedupe_key,
    );

    expect(chaves).toContain(`recalc:${longoPrazo}`);
    expect(chaves).toContain(`recalc:${curtoPrazo}`);
  });

  it('origem e destino iguais é recusado', async () => {
    const response = await transferir({ to_portfolio_id: longoPrazo });

    expect(response.status).toBe(400);
  });

  it('o preview não grava nada', async () => {
    const response = await request(harness.app)
      .post('/api/transactions/transfer/preview')
      .send({
        from_portfolio_id: longoPrazo,
        to_portfolio_id: curtoPrazo,
        asset_id: itub4,
        institution_id: corretora,
        trade_date: '2026-10-06',
        quantity: '100',
      });

    expect(response.status).toBe(200);
    expect(response.body.preview.total_change).toBe('0.00');

    const transferencias = await request(harness.app).get(
      '/api/transactions?kind=transfer',
    );
    expect(transferencias.body.total).toBe(0);
  });
});
