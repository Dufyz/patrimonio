import { searchResourceSchema } from '@patrimonio/contracts';
import type { SearchResource } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * T-09 · A rota que a paleta consome.
 *
 * A profundidade do SQL — ordem, posição somada, total — está no teste do
 * repositório, em `packages/db`. O que esta suíte prova é o que só o caminho
 * inteiro mostra: que o que as rotas de escrita gravam é o que a busca acha,
 * que a resposta cabe no contrato e que o recorte da query chega inteiro até o
 * repositório.
 */

let harness: ApiHarness;
let carteira: string;
let reserva: string;
let corretora: string;

const lancar = async (body: Record<string, unknown>) => {
  const response = await request(harness.app).post('/api/transactions').send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.transaction as { id: string; asset_id: string };
};

const compra = (
  ticker: string,
  name: string,
  trade_date: string,
  portfolio: string,
  note?: string,
) => ({
  kind: 'buy',
  portfolio_id: portfolio,
  institution_id: corretora,
  asset: { ticker, name, b3_type: 'stock' },
  trade_date,
  quantity: '100',
  unit_price: '30.00',
  fees: '0',
  ...(note === undefined ? {} : { note }),
});

const buscar = async (query: string): Promise<SearchResource> => {
  const response = await request(harness.app).get(`/api/search?${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return searchResourceSchema.parse(response.body);
};

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);

  carteira = (
    await request(harness.app).post('/api/portfolios').send({ name: 'Longo prazo' })
  ).body.portfolio.id;
  reserva = (await request(harness.app).post('/api/portfolios').send({ name: 'Reserva' }))
    .body.portfolio.id;
  corretora = await seedInstitution(harness.sql, 'Corretora A');
});

describe('o que a busca acha', () => {
  it('acha o ativo e o lançamento que as rotas de escrita gravaram', async () => {
    const compraItub4 = await lancar(
      compra('ITUB4', 'Itaú Unibanco PN', '2026-03-12', carteira),
    );
    await lancar(compra('WEGE3', 'WEG ON', '2026-03-13', carteira));

    const body = await buscar('q=itub');

    expect(body.query).toBe('itub');
    expect(body.assets.items.map((asset) => asset.ticker)).toEqual(['ITUB4']);
    expect(body.assets.items[0]?.name).toBe('Itaú Unibanco PN');
    expect(body.transactions.items.map((row) => row.id)).toEqual([compraItub4.id]);
    expect(body.transactions.items[0]?.ticker).toBe('ITUB4');
    expect(body.transactions.items[0]?.portfolio_name).toBe('Longo prazo');
  });

  it('acha o lançamento pela observação, não só pelo ativo', async () => {
    const comNota = await lancar(
      compra('WEGE3', 'WEG ON', '2026-03-13', carteira, 'reforço antes do resultado'),
    );

    const body = await buscar('q=reforço');

    expect(body.assets.items).toEqual([]);
    expect(body.transactions.items.map((row) => row.id)).toEqual([comNota.id]);
  });

  it('restringe os lançamentos à carteira da query', async () => {
    await lancar(compra('ITUB4', 'Itaú Unibanco PN', '2026-03-12', carteira));
    const naReserva = await lancar(
      compra('ITUB4', 'Itaú Unibanco PN', '2026-04-01', reserva),
    );

    const body = await buscar(`q=itub&portfolio_id=${reserva}`);

    expect(body.transactions.items.map((row) => row.id)).toEqual([naReserva.id]);
    expect(body.transactions.total).toBe(1);
  });

  it('respeita o limite e devolve o total do banco', async () => {
    await lancar(compra('ITUB4', 'Itaú Unibanco PN', '2026-03-12', carteira));
    await lancar(compra('ITUB4', 'Itaú Unibanco PN', '2026-03-13', carteira));
    await lancar(compra('ITUB4', 'Itaú Unibanco PN', '2026-03-14', carteira));

    const body = await buscar('q=itub&limit=2');

    expect(body.transactions.items).toHaveLength(2);
    expect(body.transactions.total).toBe(3);
  });

  it('devolve grupos vazios, e não erro, quando nada casa', async () => {
    const body = await buscar('q=zzzz');

    expect(body.assets).toEqual({ total: 0, items: [] });
    expect(body.transactions).toEqual({ total: 0, items: [] });
  });
});

describe('o que a busca recusa', () => {
  it.each([
    ['sem texto', ''],
    ['só espaço', 'q=%20%20'],
    ['texto longo demais', `q=${'a'.repeat(81)}`],
    ['carteira que não é UUID', 'q=itub&portfolio_id=longo-prazo'],
    ['limite acima de dez', 'q=itub&limit=11'],
    ['limite zero', 'q=itub&limit=0'],
  ])('responde 400 para %s', async (_caso, query) => {
    const response = await request(harness.app).get(`/api/search?${query}`);

    expect(response.status).toBe(400);
  });
});
