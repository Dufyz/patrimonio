import { assetPageResourceSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedCategory,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * T-03 · A rota que a página do ativo consome.
 *
 * A profundidade do SQL está no teste do repositório, em `packages/db`. O que
 * esta suíte prova é o que só o HTTP mostra: que a resposta cabe no contrato,
 * que o recorte da query chega inteiro ao caso de uso, que ativo inexistente é
 * 404 e não uma tela vazia, e que um ativo sem fechamento nenhum devolve uma
 * resposta inteira em vez de meia.
 */

let harness: ApiHarness;
let carteira: string;
let corretora: string;
let acoes: string;
let itub4: string;

const hoje = (): string => new Date().toISOString().slice(0, 10);

/** O fechamento é do worker; aqui ele é escrito à mão, que é o que a tela lê. */
const fecharDia = async (date: string, marketValue = '18420.00'): Promise<void> => {
  await harness.sql`
    INSERT INTO position_daily
      (portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
       market_value, price_source_kind)
    VALUES
      (${carteira}, ${itub4}, ${date}, '500', '29.10', '14550.00',
       ${marketValue}, 'fresh')
    ON CONFLICT (portfolio_id, asset_id, position_date) DO NOTHING
  `;
};

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
  acoes = await seedCategory(harness.sql, 'Ações', 'class.acoes');

  const compra = await request(harness.app)
    .post('/api/transactions')
    .send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretora,
      asset: {
        ticker: 'ITUB4',
        name: 'Itaú Unibanco PN',
        b3_type: 'stock',
        sector: 'Bancos',
        category_id: acoes,
      },
      trade_date: '2026-02-02',
      quantity: '500',
      unit_price: '29.10',
      fees: '0',
    });
  itub4 = compra.body.transaction.asset_id;
});

const abrir = (id = itub4, query = '') => {
  const params = new URLSearchParams(query);
  if (!params.has('portfolio_id')) params.set('portfolio_id', carteira);

  return request(harness.app).get(`/api/assets/${id}/page?${params.toString()}`);
};

describe('GET /api/assets/:asset_id/page', () => {
  it('a resposta cabe no contrato que a tela usa para lê-la', async () => {
    await fecharDia(hoje());
    const response = await abrir(itub4, `portfolio_id=${carteira}`);

    expect(response.status).toBe(200);
    const body = assetPageResourceSchema.parse(response.body);

    expect(body.as_of).toBe(hoje());
    expect(body.asset.ticker).toBe('ITUB4');
    expect(body.asset.sector).toBe('Bancos');
    expect(body.asset.category_name).toBe('Ações');
    expect(body.portfolio_name).toBe('Longo prazo');
    expect(body.position?.value).toBe('18420.00');
    expect(body.position?.avg_price).toBe('29.10000000');
  });

  it('o recorte da query chega inteiro: janela, carteira e tipo', async () => {
    await fecharDia(hoje());
    const body = assetPageResourceSchema.parse(
      (await abrir(itub4, `portfolio_id=${carteira}&period=3a&kind=buy`)).body,
    );

    expect(body.series.period).toBe('3a');
    expect(body.portfolio_id).toBe(carteira);
    expect(body.transactions.total).toBe(1);
    expect(body.transactions.recent[0]?.kind).toBe('buy');
  });

  it('sem carteira a rota recusa com 400', async () => {
    const response = await request(harness.app).get(`/api/assets/${itub4}/page`);

    expect(response.status).toBe(400);
  });

  it('a janela padrão é de um ano, e não a série inteira', async () => {
    await fecharDia(hoje());
    const body = assetPageResourceSchema.parse((await abrir()).body);

    expect(body.series.period).toBe('1a');
  });

  it('ativo sem fechamento nenhum devolve resposta inteira, e não meia', async () => {
    const response = await abrir(itub4, `portfolio_id=${carteira}`);
    const body = assetPageResourceSchema.parse(response.body);

    expect(response.status).toBe(200);
    expect(body.as_of).toBeNull();
    expect(body.position).toBeNull();
    expect(body.payouts.total_12m).toBe('0');
    expect(body.payouts.months).toHaveLength(12);
    // O histórico continua lá: o lançamento existe mesmo sem projeção.
    expect(body.transactions.total).toBe(1);
  });

  it('ativo que não existe é 404, e não uma página de traços', async () => {
    const response = await abrir('0191e5a0-0000-7000-8000-00000000dead');

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('não encontrado');
  });

  it('o código do papel abre a mesma página que o identificador', async () => {
    await fecharDia(hoje());
    const porCodigo = await abrir('itub4', `portfolio_id=${carteira}`);
    const porId = await abrir(itub4, `portfolio_id=${carteira}`);

    expect(porCodigo.status).toBe(200);
    expect(porCodigo.body.asset.asset_id).toBe(porId.body.asset.asset_id);
  });

  it('referência que não é nem código nem identificador é recusada com 400', async () => {
    const response = await abrir('itau-unibanco-preferencial');

    expect(response.status).toBe(400);
  });

  it('código que não existe é 404, como o identificador que não existe', async () => {
    const response = await abrir('zzzz9');

    expect(response.status).toBe(404);
  });

  it('janela desconhecida é recusada com 400, e não ignorada', async () => {
    const response = await abrir(itub4, 'period=decada');

    expect(response.status).toBe(400);
  });

  it('tipo de lançamento que não existe é recusado com 400', async () => {
    const response = await abrir(itub4, 'kind=emprestimo');

    expect(response.status).toBe(400);
  });

  it('a rota está na documentação', async () => {
    const docs = await request(harness.app).get('/api/docs.json');

    expect(docs.body.paths['/api/assets/{asset_id}/page']?.get?.tags).toContain('Ativos');
  });
});
