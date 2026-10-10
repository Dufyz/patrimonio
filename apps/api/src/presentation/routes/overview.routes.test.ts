import { overviewSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * A tela de abertura, pela rota, contra Postgres de verdade.
 *
 * A projeção é escrita aqui à mão porque é o motor que a escreve em produção, e
 * o que está sob teste é a leitura: o que a tela mostra quando o fechamento é
 * de sexta, quando uma carteira ficou para trás, quando não existe fechamento
 * anterior para comparar e quando o alvo não está declarado.
 */
let harness: ApiHarness;
let longo: string;
let reserva: string;
let acoes: string;
let fiis: string;
let itub4: string;
let hglg11: string;

const seedCategoria = async (name: string, token: string): Promise<string> => {
  const rows = await harness.sql<{ id: string }[]>`
    INSERT INTO category (id, name, color_token)
    VALUES (GEN_RANDOM_UUID(), ${name}, ${token})
    RETURNING id
  `;

  return rows[0]?.id ?? '';
};

const seedAtivo = async (
  ticker: string,
  name: string,
  b3Type: string,
  category: string,
): Promise<string> => {
  const rows = await harness.sql<{ id: string }[]>`
    INSERT INTO asset (id, ticker, name, origin, b3_type, category_id)
    VALUES (GEN_RANDOM_UUID(), ${ticker}, ${name}, 'market', ${b3Type}, ${category})
    RETURNING id
  `;

  return rows[0]?.id ?? '';
};

const fecharDia = async (
  portfolio: string,
  date: string,
  total: string,
  options: {
    readonly net_flow?: string;
    readonly income?: string;
    readonly payouts?: string;
    readonly quota_value?: string;
    readonly contributions?: string;
  } = {},
): Promise<void> => {
  await harness.sql`
    INSERT INTO portfolio_daily (
      portfolio_id, position_date, total_value, net_flow, income, payouts,
      quota_value, quota_count, cumulative_contributions
    )
    VALUES (
      ${portfolio}, ${date}, ${total}, ${options.net_flow ?? '0.00'},
      ${options.income ?? '0.00'}, ${options.payouts ?? '0.00'},
      ${options.quota_value ?? '1.000000000000'}, '1000.000000000000',
      ${options.contributions ?? '0.00'}
    )
    ON CONFLICT (portfolio_id, position_date) DO UPDATE
      SET total_value = EXCLUDED.total_value,
          quota_value = EXCLUDED.quota_value,
          cumulative_contributions = EXCLUDED.cumulative_contributions
  `;
};

const manterPosicao = async (
  portfolio: string,
  asset: string,
  date: string,
  value: string,
  kind: 'fresh' | 'stale' | 'manual' | 'missing' = 'fresh',
): Promise<void> => {
  await harness.sql`
    INSERT INTO position_daily (
      portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
      market_value, price_source_kind, accrued_interest
    )
    VALUES (
      ${portfolio}, ${asset}, ${date}, '100.00000000', '30.00000000', '3000.00',
      ${value}, ${kind}::computed_price_kind, '0.00'
    )
    ON CONFLICT (portfolio_id, asset_id, position_date) DO UPDATE
      SET market_value = EXCLUDED.market_value,
          price_source_kind = EXCLUDED.price_source_kind
  `;
};

const abrirAlerta = async (
  ruleKind: string,
  subject: string,
  portfolio: string | null,
): Promise<void> => {
  await harness.sql`
    INSERT INTO alert_instance (rule_kind, subject_id, portfolio_id, status, payload)
    VALUES (${ruleKind}, ${subject}, ${portfolio}, 'open', '{"ticker":"ITUB4"}'::JSONB)
  `;
};

const visaoGeral = async (query = ''): Promise<request.Response> =>
  request(harness.app).get(`/api/overview${query}`);

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);
  await harness.sql`DELETE FROM alert_instance`;
  await harness.sql`DELETE FROM portfolio_daily`;
  await harness.sql`DELETE FROM position_daily`;

  const criada = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Longo prazo', purpose: 'independência financeira', tolerance_pp: '3' });
  longo = criada.body.portfolio.id;

  const outra = await request(harness.app).post('/api/portfolios').send({ name: 'Reserva' });
  reserva = outra.body.portfolio.id;

  acoes = await seedCategoria('Ações', 'class.acoes');
  fiis = await seedCategoria('FIIs', 'class.fiis');
  itub4 = await seedAtivo('ITUB4', 'Itaú Unibanco PN', 'stock', acoes);
  hglg11 = await seedAtivo('HGLG11', 'CSHG Logística', 'fii', fiis);
});

describe('quanto eu tenho hoje', () => {
  it('a resposta valida contra o schema do contrato', async () => {
    await fecharDia(longo, '2026-10-02', '10000.00');

    const response = await visaoGeral('?on_date=2026-10-02');

    expect(response.status).toBe(200);
    expect(() => overviewSchema.parse(response.body)).not.toThrow();
  });

  it('sábado mostra o fechamento de sexta, com a data dita na resposta', async () => {
    await fecharDia(longo, '2026-10-02', '10000.00');

    const response = await visaoGeral('?on_date=2026-10-04');

    expect(response.body.reference_date).toBe('2026-10-02');
    expect(response.body.totals.value).toBe('10000.00');
  });

  it('o consolidado soma as carteiras, e o escopo de carteira mostra só ela', async () => {
    await fecharDia(longo, '2026-10-02', '10000.00');
    await fecharDia(reserva, '2026-10-02', '2500.00');

    const todas = await visaoGeral('?on_date=2026-10-02');
    const uma = await visaoGeral(`?on_date=2026-10-02&portfolio_id=${longo}`);

    expect(todas.body.totals.value).toBe('12500.00');
    expect(todas.body.scope.name).toBe('Todas as carteiras');
    expect(uma.body.totals.value).toBe('10000.00');
    // O peso da carteira no patrimônio: 10.000 de 12.500.
    expect(uma.body.totals.weight_pct).toBe('80.00');
  });

  it('a variação do dia compara com o fechamento anterior', async () => {
    await fecharDia(longo, '2026-10-01', '9800.00');
    await fecharDia(longo, '2026-10-02', '10000.00');

    const response = await visaoGeral(`?on_date=2026-10-02&portfolio_id=${longo}`);

    expect(response.body.totals.day).toEqual({ amount: '200.00', ratio: '2.04' });
  });

  it('a variação do mês compara com o último fechamento do mês anterior', async () => {
    await fecharDia(longo, '2026-09-30', '9500.00');
    await fecharDia(longo, '2026-10-02', '10000.00');

    const response = await visaoGeral(`?on_date=2026-10-02&portfolio_id=${longo}`);

    expect(response.body.totals.month).toEqual({ amount: '500.00', ratio: '5.26' });
  });

  it('primeiro fechamento da história não tem variação, e isso não é zero', async () => {
    await fecharDia(longo, '2026-10-02', '10000.00');

    const response = await visaoGeral(`?on_date=2026-10-02&portfolio_id=${longo}`);

    expect(response.body.totals.day).toBeNull();
    expect(response.body.totals.month).toBeNull();
  });

  it('carteira sem fechamento nenhum devolve a tela vazia, não erro', async () => {
    const response = await visaoGeral(`?on_date=2026-10-02&portfolio_id=${longo}`);

    expect(response.status).toBe(200);
    expect(response.body.reference_date).toBeNull();
    expect(response.body.totals.value).toBeNull();
    expect(response.body.series).toEqual([]);
  });

  it('carteira que não existe é 404, com o identificador nomeado', async () => {
    const response = await visaoGeral(
      '?portfolio_id=0191e5a0-0000-7000-8000-0000000000ff',
    );

    expect(response.status).toBe(404);
  });
});

describe('quanto veio de aporte e quanto veio de rentabilidade', () => {
  it('a série separa o aporte acumulado do que o mercado acrescentou', async () => {
    await fecharDia(longo, '2026-10-01', '9000.00', { contributions: '8000.00' });
    await fecharDia(longo, '2026-10-02', '10000.00', { contributions: '8000.00' });

    const response = await visaoGeral(
      `?on_date=2026-10-02&from=2026-10-01&to=2026-10-02&portfolio_id=${longo}`,
    );

    expect(response.body.series).toEqual([
      {
        date: '2026-10-01',
        contributions: '8000.00',
        total: '9000.00',
        result: '1000.00',
      },
      {
        date: '2026-10-02',
        contributions: '8000.00',
        total: '10000.00',
        result: '2000.00',
      },
    ]);
  });

  it('com uma carteira o retorno sai da cota gravada, e a resposta diz isso', async () => {
    await fecharDia(longo, '2026-09-30', '9500.00', { quota_value: '1.000000000000' });
    await fecharDia(longo, '2026-10-01', '9800.00', { quota_value: '1.030000000000' });
    await fecharDia(longo, '2026-10-02', '10000.00', { quota_value: '1.050000000000' });

    const response = await visaoGeral(
      `?on_date=2026-10-02&from=2026-10-01&to=2026-10-02&portfolio_id=${longo}`,
    );

    expect(response.body.period.return_method).toBe('portfolio_quota');
    expect(response.body.period.return_pct).toBe('5.00');
  });

  it('no consolidado a cota é construída sobre a janela, e o método vem declarado', async () => {
    await fecharDia(longo, '2026-09-30', '10000.00');
    await fecharDia(reserva, '2026-09-30', '10000.00');
    await fecharDia(longo, '2026-10-01', '11000.00');
    await fecharDia(reserva, '2026-10-01', '10000.00');

    const response = await visaoGeral('?on_date=2026-10-01&from=2026-10-01&to=2026-10-01');

    expect(response.body.period.return_method).toBe('window_quota');
    // 21.000 contra 20.000, sem fluxo no meio.
    expect(response.body.period.return_pct).toBe('5.00');
  });

  it('aporte no dia não vira rentabilidade', async () => {
    await fecharDia(longo, '2026-09-30', '10000.00');
    await fecharDia(longo, '2026-10-01', '15000.00', { net_flow: '5000.00' });

    const response = await visaoGeral('?on_date=2026-10-01&from=2026-10-01&to=2026-10-01');

    expect(response.body.period.contributions).toBe('5000.00');
    expect(response.body.period.return_pct).toBe('0.00');
  });

  it('a janela não muda o número principal, que é o do fechamento', async () => {
    await fecharDia(longo, '2026-09-30', '9500.00');
    await fecharDia(longo, '2026-10-02', '10000.00');

    const response = await visaoGeral(
      `?on_date=2026-10-02&from=2026-09-01&to=2026-09-30&portfolio_id=${longo}`,
    );

    expect(response.body.totals.value).toBe('10000.00');
    expect(response.body.series.at(-1).date).toBe('2026-09-30');
  });
});

describe('como o patrimônio está distribuído', () => {
  beforeEach(async () => {
    await fecharDia(longo, '2026-10-02', '13000.00');
    await manterPosicao(longo, itub4, '2026-10-02', '10000.00');
    await manterPosicao(longo, hglg11, '2026-10-02', '3000.00');
  });

  it('o peso de cada posição fecha com o total do escopo', async () => {
    const response = await visaoGeral(`?on_date=2026-10-02&portfolio_id=${longo}`);

    expect(response.body.top_positions.rows.map((row: { ticker: string; weight_pct: string }) => [
      row.ticker,
      row.weight_pct,
    ])).toEqual([
      ['ITUB4', '76.92'],
      ['HGLG11', '23.08'],
    ]);
  });

  it('a composição aponta o desvio contra o alvo declarado da carteira', async () => {
    await harness.sql`
      INSERT INTO strategy_target (portfolio_id, category_id, target_pct)
      VALUES (${longo}, ${acoes}, '60'), (${longo}, ${fiis}, '40')
    `;

    const response = await visaoGeral(`?on_date=2026-10-02&portfolio_id=${longo}`);
    const linhas: { name: string; current_pct: string; deviation_pp: string }[] =
      response.body.composition.nodes;

    expect(linhas.map((node) => [node.name, node.current_pct, node.deviation_pp])).toEqual([
      ['Ações', '76.92', '16.92'],
      ['FIIs', '23.08', '-16.92'],
    ]);
  });

  it('sem alvo declarado o desvio fica vazio, não zerado', async () => {
    const response = await visaoGeral(`?on_date=2026-10-02&portfolio_id=${longo}`);

    expect(response.body.composition.nodes[0].deviation_pp).toBeNull();
  });

  it('a distribuição por carteira acompanha, para o consolidado comparar as duas', async () => {
    await fecharDia(reserva, '2026-10-02', '7000.00');

    const response = await visaoGeral('?on_date=2026-10-02');

    expect(
      response.body.by_portfolio.map((row: { name: string; weight_pct: string }) => [
        row.name,
        row.weight_pct,
      ]),
    ).toEqual([
      ['Longo prazo', '65.00'],
      ['Reserva', '35.00'],
    ]);
  });

  it('o estado do preço viaja com a posição, para a tela não mentir sobre a data', async () => {
    await manterPosicao(longo, hglg11, '2026-10-02', '3000.00', 'stale');

    const response = await visaoGeral(`?on_date=2026-10-02&portfolio_id=${longo}`);
    const linha = response.body.top_positions.rows.find(
      (row: { ticker: string }) => row.ticker === 'HGLG11',
    );

    expect(linha.price_source_kind).toBe('stale');
  });
});

describe('o que precisa de mim', () => {
  beforeEach(async () => {
    await fecharDia(longo, '2026-10-02', '10000.00');
  });

  it('sem pendência, o painel não aparece: nenhum bloco vazio na tela', async () => {
    const response = await visaoGeral('?on_date=2026-10-02');

    expect(response.body.attention.total).toBe(0);
    expect(response.body.attention.groups).toEqual([]);
  });

  it('o alerta aberto entra no grupo da ação que ele pede', async () => {
    await abrirAlerta('price_stale', itub4, longo);

    const response = await visaoGeral('?on_date=2026-10-02');

    expect(response.body.attention.groups).toHaveLength(1);
    expect(response.body.attention.groups[0].group).toBe('corrigir');
    expect(response.body.attention.groups[0].items[0].rule_kind).toBe('price_stale');
  });

  it('o painel conta as duas leituras: esta carteira e todas', async () => {
    await abrirAlerta('price_stale', itub4, longo);
    await abrirAlerta('price_missing', hglg11, reserva);

    const response = await visaoGeral(`?on_date=2026-10-02&portfolio_id=${longo}`);

    expect(response.body.attention.total).toBe(1);
    expect(response.body.attention.total_all_portfolios).toBe(2);
  });

  it('alerta ignorado não volta para a frente do usuário', async () => {
    await abrirAlerta('price_stale', itub4, longo);
    await harness.sql`
      UPDATE alert_instance SET status = 'ignored' WHERE rule_kind = 'price_stale'
    `;

    const response = await visaoGeral('?on_date=2026-10-02');

    expect(response.body.attention.total).toBe(0);
  });

  it('alerta adiado some até a data escolhida e volta depois dela', async () => {
    await abrirAlerta('price_stale', itub4, longo);
    await harness.sql`
      UPDATE alert_instance
         SET status = 'snoozed', snooze_until = '2026-10-05'
       WHERE rule_kind = 'price_stale'
    `;

    const escondido = await visaoGeral('?on_date=2026-10-02');
    const devolta = await visaoGeral('?on_date=2026-10-06');

    expect(escondido.body.attention.total).toBe(0);
    expect(devolta.body.attention.total).toBe(1);
  });
});

describe('a janela que começa onde a carteira começou', () => {
  it('sem fechamento anterior à janela, o retorno é medido do primeiro dia dela', async () => {
    await fecharDia(longo, '2026-10-01', '10000.00', { quota_value: '1.000000000000' });
    await fecharDia(longo, '2026-10-02', '10500.00', { quota_value: '1.050000000000' });

    const response = await visaoGeral(
      `?on_date=2026-10-02&from=2026-10-01&to=2026-10-02&portfolio_id=${longo}`,
    );

    expect(response.body.period.return_pct).toBe('5.00');
    expect(response.body.period.return_method).toBe('portfolio_quota');
  });

  it('um único fechamento não produz retorno nenhum, e isso não é zero', async () => {
    await fecharDia(longo, '2026-10-02', '10000.00');

    const response = await visaoGeral('?on_date=2026-10-02&from=2026-10-02&to=2026-10-02');

    expect(response.body.period.return_pct).toBeNull();
    expect(response.body.period.return_method).toBe('unavailable');
  });
});
