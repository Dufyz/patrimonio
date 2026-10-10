import { allocationSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * A tela de Estratégia, pela rota, contra Postgres de verdade.
 *
 * O cadastro reproduz o da prancha 09 — dois grupos, uma categoria na raiz — e a
 * carteira tem mil reais, para o desvio de cada linha ser conta de cabeça. O que
 * está sob teste é a leitura: o que a tela mostra com estratégia, sem ela, com
 * categoria vazia, com ativo fora do cadastro, e o que a sugestão de aporte
 * compra e, principalmente, o que ela nunca vende.
 */
let harness: ApiHarness;
let longo: string;

let renda_variavel: string;
let acoes: string;
let fiis: string;
let renda_fixa: string;
let inflacao: string;
let prefixada: string;
let posfixada: string;
let caixa: string;

const DIA = '2026-06-30';

const categoria = async (
  name: string,
  token: string,
  sortOrder: number,
  parent: string | null = null,
): Promise<string> => {
  const rows = await harness.sql<{ id: string }[]>`
    INSERT INTO category (id, parent_id, name, color_token, sort_order)
    VALUES (GEN_RANDOM_UUID(), ${parent}, ${name}, ${token}, ${sortOrder})
    RETURNING id
  `;
  return rows[0]?.id ?? '';
};

/** Um ativo com posição no dia. `category` nulo é ativo sem categoria. */
const posicao = async (
  ticker: string,
  category: string | null,
  value: string,
): Promise<void> => {
  const ativo = await harness.sql<{ id: string }[]>`
    INSERT INTO asset (id, ticker, name, origin, category_id)
    VALUES (GEN_RANDOM_UUID(), ${ticker}, ${ticker}, 'market', ${category})
    RETURNING id
  `;

  await harness.sql`
    INSERT INTO position_daily (
      portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
      market_value, price_source_kind, accrued_interest
    )
    VALUES (${longo}, ${ativo[0]?.id ?? ''}, ${DIA}, '1.00000000', ${value}, ${value},
            ${value}, 'fresh', '0.00')
  `;
};

const fechar = async (total: string): Promise<void> => {
  await harness.sql`
    INSERT INTO portfolio_daily (
      portfolio_id, position_date, total_value, net_flow, income, payouts,
      quota_value, quota_count, cumulative_contributions
    )
    VALUES (${longo}, ${DIA}, ${total}, '0.00', '0.00', '0.00',
            '1.000000000000', '1000.000000000000', '0.00')
  `;
};

/** A carteira da prancha, em escala de mil: 300, 200, 250, 150, 0 e 100. */
const carteiraDaPrancha = async (): Promise<void> => {
  await posicao('ACOES1', acoes, '300.00');
  await posicao('FIIS1', fiis, '200.00');
  await posicao('IPCA1', inflacao, '250.00');
  await posicao('PRE1', prefixada, '150.00');
  await posicao('CAIXA1', caixa, '100.00');
  await fechar('1000.00');
};

const estrategiaDaPrancha = async (): Promise<void> => {
  const response = await request(harness.app)
    .put(`/api/portfolios/${longo}/strategy`)
    .send({
      targets: [
        { category_id: acoes, target_pct: '35' },
        { category_id: fiis, target_pct: '25' },
        { category_id: inflacao, target_pct: '25' },
        { category_id: prefixada, target_pct: '12' },
        { category_id: caixa, target_pct: '3' },
      ],
    });

  expect(response.status).toBe(200);
};

const estrategia = async (query = ''): Promise<request.Response> =>
  request(harness.app).get(`/api/allocation?portfolio_id=${longo}&on_date=${DIA}${query}`);

type Node = {
  id: string;
  name: string;
  level: string;
  value: string;
  current_pct: string;
  target_pct: string | null;
  deviation_pp: string | null;
  over_tolerance: boolean;
  amount_to_move: string | null;
  color_token: string;
  children: Node[];
};

const achar = (nodes: Node[], name: string): Node => {
  for (const node of nodes) {
    if (node.name === name) return node;
    const filho = node.children.find((child) => child.name === name);
    if (filho !== undefined) return filho;
  }
  throw new Error(`linha ${name} não está na resposta`);
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
  longo = criada.body.portfolio.id;

  renda_variavel = await categoria('Renda variável', 'class.renda-variavel', 1);
  acoes = await categoria('Ações', 'class.acoes', 1, renda_variavel);
  fiis = await categoria('FIIs', 'class.fiis', 2, renda_variavel);
  renda_fixa = await categoria('Renda fixa', 'class.renda-fixa', 2);
  inflacao = await categoria('Inflação', 'class.rf-inflacao', 1, renda_fixa);
  prefixada = await categoria('Prefixada', 'class.rf-prefixada', 2, renda_fixa);
  posfixada = await categoria('Pós-fixada', 'class.rf-posfixada', 3, renda_fixa);
  caixa = await categoria('Caixa', 'class.caixa', 3);
});

describe('GET /api/allocation · a estratégia lida', () => {
  it('responde dentro do contrato, com as regras da carteira', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();

    const response = await estrategia();

    expect(response.status).toBe(200);
    expect(() => allocationSchema.parse(response.body)).not.toThrow();
    expect(response.body.reference_date).toBe(DIA);
    expect(response.body.portfolio).toMatchObject({
      id: longo,
      name: 'Longo prazo',
    });
    expect(response.body.rules).toMatchObject({ tolerance_pp: '5.00' });
    expect(response.body.strategy_defined).toBe(true);
  });

  it('atual, alvo, desvio e valor a mover saem prontos, por categoria', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();

    const { composition } = (await estrategia()).body;
    const nodes = composition.nodes as Node[];

    expect(composition.total).toBe('1000.00');

    const acao = achar(nodes, 'Ações');
    expect(acao).toMatchObject({
      level: 'category',
      value: '300.00',
      current_pct: '30.00',
      target_pct: '35.00',
      deviation_pp: '-5.00',
      amount_to_move: '50.00',
      target_value: '350.00',
      color_token: 'class.acoes',
    });

    // Passou do alvo: o valor a mover é negativo, e a linha diz quanto.
    expect(achar(nodes, 'Prefixada')).toMatchObject({
      current_pct: '15.00',
      target_pct: '12.00',
      deviation_pp: '3.00',
      amount_to_move: '-30.00',
    });
  });

  it('o grupo é a soma das categorias, no valor, no alvo e no desvio', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();

    const nodes = (await estrategia()).body.composition.nodes as Node[];

    const variavel = achar(nodes, 'Renda variável');
    expect(variavel).toMatchObject({
      level: 'group',
      value: '500.00',
      current_pct: '50.00',
      target_pct: '60.00',
      deviation_pp: '-10.00',
      amount_to_move: '100.00',
    });
    expect(variavel.children.map((child) => child.name)).toEqual(['Ações', 'FIIs']);

    const fixa = achar(nodes, 'Renda fixa');
    expect(fixa).toMatchObject({ value: '400.00', target_pct: '37.00', deviation_pp: '3.00' });

    const somaDosAlvos = nodes.reduce((total, node) => total + Number(node.target_pct ?? 0), 0);
    expect(somaDosAlvos).toBe(100);
  });

  it('a linha acima da tolerância da carteira chega marcada', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();

    const nodes = (await estrategia()).body.composition.nodes as Node[];

    // Tolerância de 5 pp: Ações (−5) está no limite e Prefixada (+3) dentro dele.
    expect(achar(nodes, 'Ações').over_tolerance).toBe(false);
    expect(achar(nodes, 'Prefixada').over_tolerance).toBe(false);
    // Inflação: 25,00 contra 25 — no alvo.
    expect(achar(nodes, 'Inflação')).toMatchObject({ deviation_pp: '0.00', over_tolerance: false });
    // Caixa: 10,00 contra 3, 7 pp acima.
    expect(achar(nodes, 'Caixa').over_tolerance).toBe(true);
  });

  it('com estratégia, a categoria sem linha de alvo tem alvo zero, não vazio', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();

    const nodes = (await estrategia()).body.composition.nodes as Node[];

    // Pós-fixada não tem posição nem linha de alvo, e ainda assim aparece:
    // é o que permite declarar alvo para uma categoria vazia.
    expect(achar(nodes, 'Pós-fixada')).toMatchObject({
      value: '0.00',
      target_pct: '0.00',
      deviation_pp: '0.00',
      over_tolerance: false,
      amount_to_move: '0.00',
    });
  });

  it('o desvio de quem tem posição e alvo zero é a posição inteira', async () => {
    await carteiraDaPrancha();
    await posicao('POS1', posfixada, '100.00');
    await harness.sql`UPDATE portfolio_daily SET total_value = '1100.00'`;
    await estrategiaDaPrancha();

    const nodes = (await estrategia()).body.composition.nodes as Node[];

    expect(achar(nodes, 'Pós-fixada')).toMatchObject({
      target_pct: '0.00',
      current_pct: '9.09',
      deviation_pp: '9.09',
      amount_to_move: '-100.00',
    });
  });

  it('sem estratégia, a coluna de desvio fica vazia — e não mostra desvio contra o nada', async () => {
    await carteiraDaPrancha();

    const response = await estrategia();
    const nodes = response.body.composition.nodes as Node[];

    expect(response.body.strategy_defined).toBe(false);
    expect(response.body.rules.reviewed_on).toBeNull();
    expect(response.body.composition.target_sum).toMatchObject({ total_pct: '0.00', closes: true });

    for (const nome of ['Ações', 'FIIs', 'Caixa', 'Renda variável']) {
      expect(achar(nodes, nome)).toMatchObject({
        target_pct: null,
        deviation_pp: null,
        over_tolerance: false,
        amount_to_move: null,
      });
    }
    // O atual continua verdadeiro: é a composição real.
    expect(achar(nodes, 'Ações').current_pct).toBe('30.00');
  });

  it('a ordem é a do cadastro, não a do valor', async () => {
    await carteiraDaPrancha();
    // FIIs passa a valer mais que Ações; a linha não troca de lugar.
    await harness.sql`UPDATE position_daily SET market_value = '900.00' WHERE asset_id = (SELECT id FROM asset WHERE ticker = 'FIIS1')`;
    await harness.sql`UPDATE portfolio_daily SET total_value = '1700.00'`;

    const nodes = (await estrategia()).body.composition.nodes as Node[];

    expect(nodes.map((node) => node.name)).toEqual(['Renda variável', 'Renda fixa', 'Caixa']);
    expect(nodes[0]?.children.map((child) => child.name)).toEqual(['Ações', 'FIIs']);
    expect(nodes[1]?.children.map((child) => child.name)).toEqual([
      'Inflação',
      'Prefixada',
      'Pós-fixada',
    ]);
  });

  it('ativo direto num grupo vira a linha "Outros" do grupo, e o grupo continua somando', async () => {
    await carteiraDaPrancha();
    await posicao('DIRETO1', renda_variavel, '100.00');
    await harness.sql`UPDATE portfolio_daily SET total_value = '1100.00'`;

    const nodes = (await estrategia()).body.composition.nodes as Node[];
    const variavel = achar(nodes, 'Renda variável');

    expect(variavel.value).toBe('600.00');
    expect(variavel.children.map((child) => [child.name, child.value])).toEqual([
      ['Ações', '300.00'],
      ['FIIs', '200.00'],
      ['Outros', '100.00'],
    ]);
  });

  it('ativo sem categoria entra no total, sem alvo possível', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();
    await posicao('SEMCAT1', null, '100.00');
    await harness.sql`UPDATE portfolio_daily SET total_value = '1100.00'`;

    const { composition } = (await estrategia()).body;
    const semCategoria = achar(composition.nodes as Node[], 'Sem categoria');

    expect(composition.total).toBe('1100.00');
    expect(semCategoria).toMatchObject({
      value: '100.00',
      target_pct: null,
      deviation_pp: null,
      amount_to_move: null,
    });
  });

  it('carteira sem posição nenhuma lista o cadastro inteiro, tudo em zero', async () => {
    await estrategiaDaPrancha();

    const response = await estrategia();
    const nodes = response.body.composition.nodes as Node[];

    expect(response.status).toBe(200);
    expect(response.body.reference_date).toBeNull();
    expect(response.body.composition.total).toBe('0.00');
    expect(achar(nodes, 'Ações')).toMatchObject({
      value: '0.00',
      current_pct: '0.00',
      target_pct: '35.00',
      deviation_pp: '-35.00',
    });
  });

  it('a revisão é o dia em que a estratégia foi salva', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();

    const { rules } = (await estrategia()).body;

    expect(rules.reviewed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('o benchmark da carteira vem com o nome', async () => {
    await carteiraDaPrancha();
    await harness.sql`
      UPDATE portfolio SET benchmark = 'CDI'
    `;

    const { rules } = (await estrategia()).body;

    expect(rules.benchmark).toEqual({ value: 'CDI', name: 'CDI' });
  });
});

describe('GET /api/allocation · o aporte', () => {
  it('sem valor de aporte, a resposta não traz sugestão', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();

    expect((await estrategia()).body.contribution).toBeNull();
  });

  it('compra só o que fica abaixo do alvo e reduz o maior desvio', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();

    const { contribution } = (await estrategia('&contribution=400.00')).body;

    expect(contribution.amount).toBe('400.00');
    expect(contribution.allocated).toBe('400.00');
    expect(contribution.unallocated).toBe('0.00');

    const nomes = contribution.shares.map((share: { name: string }) => share.name);
    // Depois de 400 o patrimônio é 1.400. Faltam 190 em Ações (35% = 490), 150 em
    // FIIs (350), 100 em Inflação (350) e 18 em Prefixada (168): 458, mais que o
    // aporte, então a falta é repartida em proporção. Caixa (3% = 42) já tem 100
    // e Pós-fixada tem alvo zero: nenhuma das duas recebe.
    expect(nomes.sort()).toEqual(['Ações', 'FIIs', 'Inflação', 'Prefixada']);

    const soma = contribution.shares.reduce(
      (total: number, share: { amount: string }) => total + Number(share.amount),
      0,
    );
    expect(soma.toFixed(2)).toBe('400.00');

    expect(Number(contribution.max_deviation_after_pp)).toBeLessThan(
      Number(contribution.max_deviation_before_pp),
    );
  });

  it('cada parte traz o nome e a cor da categoria, que é a mesma da tabela', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();

    const { contribution } = (await estrategia('&contribution=400.00')).body;
    const acoesParte = contribution.shares.find((share: { name: string }) => share.name === 'Ações');

    expect(acoesParte).toMatchObject({ category_id: acoes, color_token: 'class.acoes' });
  });

  it('o aporte nunca vende: o que passou do alvo não recebe nada', async () => {
    await carteiraDaPrancha();
    await estrategiaDaPrancha();

    const { contribution } = (await estrategia('&contribution=50.00')).body;

    for (const parte of contribution.shares) {
      expect(Number(parte.amount)).toBeGreaterThan(0);
    }
  });

  it('sem estratégia declarada não há o que sugerir: o aporte inteiro fica sem alocar', async () => {
    await carteiraDaPrancha();

    const { contribution } = (await estrategia('&contribution=400.00')).body;

    expect(contribution.shares).toEqual([]);
    expect(contribution.unallocated).toBe('400.00');
    expect(contribution.max_deviation_before_pp).toBeNull();
  });

  it('aporte que a falta não absorve deixa o resto sem alocar', async () => {
    await posicao('ACOES1', acoes, '600.00');
    await posicao('FIIS1', fiis, '400.00');
    await fechar('1000.00');
    await request(harness.app)
      .put(`/api/portfolios/${longo}/strategy`)
      .send({
        targets: [
          { category_id: acoes, target_pct: '50' },
          { category_id: fiis, target_pct: '50' },
        ],
      });

    // Depois de 100: 1.100. Ações 550 (já tem 600), FIIs 550 (falta 150): só FIIs
    // recebe, e recebe os 100 inteiros.
    const { contribution } = (await estrategia('&contribution=100.00')).body;

    expect(contribution.shares).toHaveLength(1);
    expect(contribution.shares[0]).toMatchObject({ name: 'FIIs', amount: '100.00' });
    expect(contribution.allocated).toBe('100.00');
  });
});

describe('GET /api/allocation · o que a rota recusa', () => {
  it('carteira que não existe é 404, não uma estratégia vazia', async () => {
    const response = await request(harness.app).get(
      '/api/allocation?portfolio_id=0191e5a0-0000-7000-8000-000000000000',
    );

    expect(response.status).toBe(404);
  });

  it('carteira arquivada é 404', async () => {
    await request(harness.app).post(`/api/portfolios/${longo}/archive`).send({ archived: true });

    const response = await estrategia();

    expect(response.status).toBe(404);
  });

  it('sem carteira não há estratégia: o consolidado não tem alvo', async () => {
    const response = await request(harness.app).get('/api/allocation');

    expect(response.status).toBe(400);
  });

  it('aporte zero, negativo ou que não é número é recusado', async () => {
    for (const valor of ['0', '-10', 'abc']) {
      const response = await estrategia(`&contribution=${valor}`);
      expect(response.status).toBe(400);
    }
  });
});
