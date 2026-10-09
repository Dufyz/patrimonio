import { positionsResourceSchema } from '@patrimonio/contracts';
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
 * T-02 · A rota que a tela de Posições consome.
 *
 * A profundidade do SQL está no teste do repositório, em `packages/db`. O que
 * esta suíte prova é o que só o HTTP mostra: que a resposta cabe no contrato,
 * que o recorte da query chega inteiro ao caso de uso, e que um recorte vazio
 * devolve uma resposta completa em vez de meia.
 */

let harness: ApiHarness;
let carteira: string;
let corretora: string;
let acoes: string;
let itub4: string;

/** O fechamento é do worker; aqui ele é escrito à mão, que é o que a tela lê. */
const fecharDia = async (date: string): Promise<void> => {
  await harness.sql`
    insert into position_daily
      (portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
       market_value, price_source_kind)
    values
      (${carteira}, ${itub4}, ${date}, '500', '29.10', '14550.00', '18420.00', 'fresh')
    on conflict (portfolio_id, asset_id, position_date) do nothing
  `;
};

const hoje = (): string => new Date().toISOString().slice(0, 10);

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
        category_id: acoes,
      },
      trade_date: '2026-02-02',
      quantity: '500',
      unit_price: '29.10',
      fees: '0',
    });
  itub4 = compra.body.transaction.asset_id;
});

const listar = (query = '') =>
  request(harness.app).get(`/api/positions${query === '' ? '' : `?${query}`}`);

describe('GET /api/positions', () => {
  it('a resposta cabe no contrato que a tela usa para lê-la', async () => {
    await fecharDia(hoje());
    const response = await listar(`portfolio_id=${carteira}`);

    expect(response.status).toBe(200);
    const body = positionsResourceSchema.parse(response.body);

    expect(body.as_of).toBe(hoje());
    expect(body.group_by).toBe('category');
    expect(body.total.count).toBe(1);
    expect(body.total.value).toBe('18420.00');
    expect(body.groups[0]?.label).toBe('Ações');
    expect(body.groups[0]?.color_token).toBe('class.acoes');
    expect(body.groups[0]?.positions[0]?.ticker).toBe('ITUB4');
  });

  it('o subtotal do grupo e o total geral vêm somados daqui, não da tela', async () => {
    await fecharDia(hoje());
    const body = positionsResourceSchema.parse(
      (await listar(`portfolio_id=${carteira}`)).body,
    );

    expect(body.groups[0]?.summary.value).toBe(body.total.value);
    expect(body.groups[0]?.positions[0]?.weight).toBe('1.000000');
  });

  it('o agrupamento pedido é o que volta', async () => {
    await fecharDia(hoje());
    const body = positionsResourceSchema.parse(
      (await listar(`portfolio_id=${carteira}&group_by=institution`)).body,
    );

    expect(body.group_by).toBe('institution');
    expect(body.groups[0]?.label).toBe('Corretora A');
  });

  it('a busca que não encontra nada devolve resposta inteira, e não meia', async () => {
    await fecharDia(hoje());
    const body = positionsResourceSchema.parse(
      (await listar(`portfolio_id=${carteira}&search=zzz`)).body,
    );

    expect(body.groups).toHaveLength(0);
    expect(body.total.count).toBe(0);
    expect(body.total.value).toBe('0');
    // A pastilha continua contando o que existe fora da busca? Não: a busca é
    // o recorte, e a categoria é o filtro dentro dele.
    expect(body.facets).toHaveLength(0);
  });

  it('carteira sem fechamento nenhum não é erro: é a tela de primeiro uso', async () => {
    const response = await listar(`portfolio_id=${carteira}`);
    const body = positionsResourceSchema.parse(response.body);

    expect(response.status).toBe(200);
    expect(body.as_of).toBeNull();
    expect(body.groups).toHaveLength(0);
    expect(body.payouts_12m).toBe('0');
  });

  it('sem carteira, o escopo é todas elas', async () => {
    await fecharDia(hoje());
    const body = positionsResourceSchema.parse((await listar()).body);

    expect(body.total.count).toBe(1);
  });

  it('agrupamento desconhecido é recusado com 400, e não ignorado', async () => {
    const response = await listar('group_by=setor');

    expect(response.status).toBe(400);
  });

  it('carteira que não é um identificador é recusada com 400', async () => {
    const response = await listar('portfolio_id=longo-prazo');

    expect(response.status).toBe(400);
  });

  it('a rota está na documentação', async () => {
    const docs = await request(harness.app).get('/api/docs.json');

    expect(docs.body.paths['/api/positions']?.get?.tags).toContain('Posições');
  });
});
