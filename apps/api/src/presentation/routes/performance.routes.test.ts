import { performanceSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * A tela de Desempenho, pela rota, contra Postgres de verdade.
 *
 * Os fechamentos são escritos à mão porque é o motor de projeção que os escreve
 * em produção; o que está sob teste é a leitura: o que cada janela, cada mês e
 * cada classe mostram, e principalmente o que **não** mostram — retorno que não
 * dá para calcular chega como traço, e aporte nunca é rendimento.
 */
let harness: ApiHarness;
let longo: string;
let acoes: string;
let itub4: string;
let corretora: string;

const CDI = 'CDI';
const IPCA = 'IPCA';
const IBOV = 'IBOV';

const fecharDia = async (
  portfolio: string,
  date: string,
  total: string,
  quota: string,
  options: {
    readonly net_flow?: string;
    readonly income?: string;
    readonly payouts?: string;
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
      ${quota}, '1000.000000000000', '0.00'
    )
  `;
};

/** O longo prazo, com um aporte em maio: 10.000 → 10.500 → 12.600 → 13.000. */
const historiaDoLongo = async (): Promise<void> => {
  await fecharDia(longo, '2026-03-31', '10000.00', '1.000000000000', {
    net_flow: '10000.00',
  });
  await fecharDia(longo, '2026-04-30', '10500.00', '1.050000000000');
  await fecharDia(longo, '2026-05-29', '12600.00', '1.060000000000', {
    net_flow: '2000.00',
  });
  await fecharDia(longo, '2026-06-30', '13000.00', '1.100000000000', {
    income: '100.00',
    payouts: '100.00',
  });
};

const fatores = async (
  code: string,
  from: string,
  to: string,
  daily: string,
): Promise<void> => {
  await harness.sql`
    INSERT INTO index_quote (index_code, quote_date, daily_factor, raw_value, source)
    SELECT ${code}, calendar_date, ${daily}, '0', 'teste'
      FROM business_day
     WHERE is_business_day AND calendar_date BETWEEN ${from}::DATE AND ${to}::DATE
    ON CONFLICT (index_code, quote_date) DO NOTHING
  `;
};

const diasUteis = async (after: string, until: string): Promise<number> => {
  const rows = await harness.sql<{ total: string }[]>`
    SELECT COUNT(*)::TEXT AS total
      FROM business_day
     WHERE is_business_day AND calendar_date > ${after}::DATE AND calendar_date <= ${until}::DATE
  `;

  return Number(rows[0]?.total ?? 0);
};

const posicao = async (asset: string, date: string, value: string): Promise<void> => {
  await harness.sql`
    INSERT INTO position_daily (
      portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
      market_value, price_source_kind, accrued_interest
    )
    VALUES (${longo}, ${asset}, ${date}, '100.00000000', '10.00000000', '1000.00',
            ${value}, 'fresh', '0.00')
  `;
};

const lancar = async (
  n: number,
  kind: string,
  date: string,
  net: string,
  payoutKind: string | null = null,
): Promise<void> => {
  await harness.sql`
    INSERT INTO transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
       quantity, unit_price, fees, gross_amount, net_amount, payout_kind, confirmed_at)
    VALUES
      (${`0191e5a0-0000-7000-8000-0000000d${String(n).padStart(4, '0')}`},
       ${kind}::transaction_kind, ${date}, ${date}, ${longo}, ${itub4}, ${corretora},
       '1', '1', '0', ${net}, ${net}, ${payoutKind}::payout_kind, NOW())
  `;
};

const desempenho = async (query = ''): Promise<request.Response> => {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  if (!params.has('portfolio_id')) params.set('portfolio_id', longo);

  return request(harness.app).get(`/api/performance?${params.toString()}`);
};

const doLongo = (extra = ''): string =>
  `?portfolio_id=${longo}&on_date=2026-06-30${extra}`;

const numero = (value: string | null | undefined): number => Number(value);

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);
  await harness.sql`DELETE FROM portfolio_daily`;
  await harness.sql`DELETE FROM position_daily`;

  const criada = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Longo prazo', benchmark: 'cdi' });
  longo = criada.body.portfolio.id;

  const categoria = await harness.sql<{ id: string }[]>`
    INSERT INTO category (id, name, color_token)
    VALUES (GEN_RANDOM_UUID(), 'Ações', 'class.acoes')
    RETURNING id
  `;
  acoes = categoria[0]?.id ?? '';

  const ativo = await harness.sql<{ id: string }[]>`
    INSERT INTO asset (id, ticker, name, origin, b3_type, category_id)
    VALUES (GEN_RANDOM_UUID(), 'ITUB4', 'Itaú Unibanco PN', 'market', 'stock', ${acoes})
    RETURNING id
  `;
  itub4 = ativo[0]?.id ?? '';

  const instituicao = await harness.sql<{ id: string }[]>`
    INSERT INTO institution (id, name, role)
    VALUES (GEN_RANDOM_UUID(), 'Corretora A', 'custodian')
    RETURNING id
  `;
  corretora = instituicao[0]?.id ?? '';
});

describe('GET /api/performance · a carteira', () => {
  it('responde dentro do contrato e declara o método', async () => {
    await historiaDoLongo();

    const response = await desempenho(doLongo());

    expect(response.status).toBe(200);
    expect(() => performanceSchema.parse(response.body)).not.toThrow();
    expect(response.body.reference_date).toBe('2026-06-30');
    expect(response.body.scope).toMatchObject({
      portfolio_id: longo,
      name: 'Longo prazo',
      inception: '2026-03-31',
    });
    expect(response.body.method).toEqual({
      portfolio: 'portfolio_quota',
      class: 'modified_dietz',
      benchmark: 'compound_daily_factors',
      annualized: false,
    });
  });

  it('mede cada janela pela cota: o aporte de maio não é rendimento', async () => {
    await historiaDoLongo();

    const { windows } = (await desempenho(doLongo())).body;
    const carteira = windows.rows[0];

    expect(windows.columns.map((column: { key: string }) => column.key)).toEqual([
      'month',
      '3m',
      '6m',
      'ytd',
      '12m',
      '24m',
      'inception',
    ]);
    expect(carteira.kind).toBe('portfolio');
    // Mês: 1,06 → 1,10. O patrimônio do mês subiu 3,2%, mas o mês anterior
    // recebeu 2.000 de aporte; a cota não.
    expect(carteira.values[0]).toBe('3.77');
    // Desde o início: 1,00 → 1,10.
    expect(carteira.values[6]).toBe('10.00');
  });

  it('janela maior que o histórico é traço, não zero e não anualizada', async () => {
    await historiaDoLongo();

    const { windows } = (await desempenho(doLongo())).body;
    const carteira = windows.rows[0];
    const chaves = windows.columns.map((column: { key: string }) => column.key);

    for (const chave of ['3m', '6m', 'ytd', '12m', '24m']) {
      const posicaoDaJanela = chaves.indexOf(chave);
      expect(carteira.values[posicaoDaJanela]).toBeNull();
      expect(windows.columns[posicaoDaJanela].base_date).toBeNull();
    }
  });

  it('o gráfico parte da base em 0% e termina no retorno desde o início', async () => {
    await historiaDoLongo();

    const { chart } = (await desempenho(doLongo())).body;

    expect(chart.base_date).toBe('2026-03-31');
    expect(chart.dates[0]).toBe('2026-03-31');
    expect(chart.portfolio[0]).toBe('0.00');
    expect(chart.portfolio.at(-1)).toBe('10.00');
    expect(chart.portfolio).toHaveLength(chart.dates.length);
  });

  it('a grade mensal traz o ano com o total e o parcial', async () => {
    await historiaDoLongo();

    const { monthly } = (await desempenho(doLongo())).body;
    const ano = monthly.years[0];

    expect(monthly.benchmark_name).toBe('CDI');
    expect(ano.year).toBe(2026);
    expect(ano.months).toHaveLength(12);
    // Abril, maio e junho. Janeiro e fevereiro são anteriores ao primeiro
    // fechamento: traço.
    expect(ano.months.slice(0, 2)).toEqual([null, null]);
    expect(ano.months[3]).toBe('5.00');
    expect(ano.months[4]).toBe('0.95');
    expect(ano.months[5]).toBe('3.77');
    expect(ano.months.slice(6)).toEqual(Array(6).fill(null));
    expect(ano.total_pct).toBe('10.00');
    expect(ano.partial).toBe(true);
  });

  it('a decomposição vai do mês mais recente ao mais antigo, com o total', async () => {
    await historiaDoLongo();

    const { decomposition } = (await desempenho(doLongo())).body;

    expect(decomposition.rows.map((row: { month: string }) => row.month)).toEqual([
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
    ]);

    const maio = decomposition.rows[1];
    expect(maio).toMatchObject({
      opening_value: '10500.00',
      net_flow: '2000.00',
      closing_value: '12600.00',
      return_pct: '0.95',
    });

    const junho = decomposition.rows[0];
    expect(junho).toMatchObject({
      income: '100.00',
      payouts: '100.00',
      return_pct: '3.77',
    });

    expect(decomposition.total).toMatchObject({
      months: 4,
      from: '2026-03-31',
      to: '2026-06-30',
      opening_value: '0.00',
      net_flow: '12000.00',
      closing_value: '13000.00',
    });
  });

  it('a decomposição fecha: abertura + aporte + variação de preço = fechamento', async () => {
    await historiaDoLongo();

    const { decomposition } = (await desempenho(doLongo())).body;

    for (const row of decomposition.rows) {
      const variacao =
        numero(row.closing_value) - numero(row.opening_value) - numero(row.net_flow);

      expect(numero(row.opening_value) + numero(row.net_flow) + variacao).toBeCloseTo(
        numero(row.closing_value),
        2,
      );
    }
    expect(numero(decomposition.total.net_flow)).toBeCloseTo(
      decomposition.rows.reduce(
        (sum: number, row: { net_flow: string }) => sum + numero(row.net_flow),
        0,
      ),
      2,
    );
  });
});

describe('GET /api/performance · benchmarks', () => {
  it('a linha do benchmark é o produto dos fatores, e a diferença é em pontos', async () => {
    await historiaDoLongo();
    await fatores('CDI', '2026-04-01', '2026-06-30', '1.000500000000');

    const dias = await diasUteis('2026-03-31', '2026-06-30');
    const esperado = (1.0005 ** dias - 1) * 100;

    const { windows } = (await desempenho(doLongo())).body;
    const [carteira, cdi, diferenca] = windows.rows;

    expect(cdi).toMatchObject({ kind: 'benchmark', benchmark: CDI, name: 'CDI' });
    expect(numero(cdi.values[6])).toBeCloseTo(esperado, 2);
    expect(diferenca.kind).toBe('difference');
    expect(numero(diferenca.values[6])).toBeCloseTo(
      numero(carteira.values[6]) - esperado,
      1,
    );
  });

  it('benchmark sem nenhum fator é traço — não rendeu zero, não foi medido', async () => {
    await historiaDoLongo();

    const body = (await desempenho(doLongo())).body;
    const [, cdi, diferenca] = body.windows.rows;

    expect(cdi.values.every((value: string | null) => value === null)).toBe(true);
    expect(diferenca.values.every((value: string | null) => value === null)).toBe(true);
    // E não vira uma linha reta em zero no gráfico.
    expect(body.chart.benchmarks).toEqual([]);
    expect(body.benchmarks.selected.map((item: { id: string }) => item.id)).toEqual([
      CDI,
    ]);
  });

  it('benchmarks acrescenta à tela, atrás do benchmark da carteira, na ordem pedida', async () => {
    await historiaDoLongo();
    await fatores('CDI', '2026-04-01', '2026-06-30', '1.000500000000');
    await fatores('IPCA', '2026-04-01', '2026-06-30', '1.000100000000');
    await fatores('IBOV', '2026-04-01', '2026-06-30', '1.001000000000');

    const body = (await desempenho(doLongo(`&benchmarks=${IBOV},${IPCA}`))).body;

    expect(body.benchmarks.primary_id).toBe(CDI);
    expect(body.benchmarks.selected.map((item: { id: string }) => item.id)).toEqual([
      CDI,
      IBOV,
      IPCA,
    ]);
    expect(
      body.windows.rows
        .filter((row: { kind: string }) => row.kind === 'benchmark')
        .map((row: { benchmark: string }) => row.benchmark),
    ).toEqual([CDI, IBOV, IPCA]);
    expect(body.chart.benchmarks.map((item: { id: string }) => item.id)).toEqual([
      CDI,
      IBOV,
      IPCA,
    ]);
    expect(body.benchmarks.available.map((item: { name: string }) => item.name)).toEqual([
      'CDI',
      'Ibovespa',
      'IFIX',
      'IPCA',
      'Selic',
    ]);
  });

  it('o benchmark da carteira pode ser IPCA+6 ou 110%CDI, e entra na lista e à frente', async () => {
    await historiaDoLongo();
    await fatores('CDI', '2026-04-01', '2026-06-30', '1.000500000000');
    await fatores('IPCA', '2026-04-01', '2026-06-30', '1.000100000000');
    await harness.sql`UPDATE portfolio SET benchmark = '110%CDI' WHERE id = ${longo}::UUID`;

    const body = (await desempenho(doLongo(`&benchmarks=${encodeURIComponent('IPCA+6')}`))).body;

    expect(body.benchmarks.primary_id).toBe('110%CDI');
    expect(body.benchmarks.selected.map((item: { id: string }) => item.id)).toEqual([
      '110%CDI',
      'IPCA+6',
    ]);
    expect(body.benchmarks.selected.map((item: { name: string }) => item.name)).toEqual([
      '110% do CDI',
      'IPCA + 6%',
    ]);
    expect(body.benchmarks.available.map((item: { id: string }) => item.id)).toContain('110%CDI');
  });

  it('o gráfico do benchmark tem o comprimento da carteira e parte de zero', async () => {
    await historiaDoLongo();
    await fatores('CDI', '2026-04-01', '2026-06-30', '1.000500000000');

    const { chart } = (await desempenho(doLongo())).body;

    expect(chart.benchmarks).toHaveLength(1);
    expect(chart.benchmarks[0].values).toHaveLength(chart.dates.length);
    expect(chart.benchmarks[0].values[0]).toBe('0.00');
    expect(numero(chart.benchmarks[0].values.at(-1))).toBeGreaterThan(0);
  });
});

describe('GET /api/performance · por classe', () => {
  it('as colunas do detalhamento são mês, ano, doze meses e início', async () => {
    await historiaDoLongo();

    const { breakdown } = (await desempenho(doLongo())).body;

    expect(breakdown.columns.map((column: { key: string }) => column.key)).toEqual([
      'month',
      'ytd',
      '12m',
      'inception',
    ]);
    expect(breakdown.portfolios).toBeUndefined();
  });

  it('a classe rende por Dietz modificado: o aporte pesa pelo tempo que ficou investido', async () => {
    await historiaDoLongo();
    await posicao(itub4, '2026-03-31', '1000.00');
    await posicao(itub4, '2026-06-30', '1700.00');
    // Compra de 500 a meio do período: entra no capital pelo tempo que ficou.
    await lancar(1, 'buy', '2026-05-15', '-500.00');

    const { breakdown } = (await desempenho(doLongo())).body;
    const classe = breakdown.classes.find(
      (row: { name: string }) => row.name === 'Ações',
    );

    // Ganho: 1.700 − 1.000 − 500 = 200. Capital: 1.000 + 500 × (46/91).
    // 200 / 1.252,75 = 15,96%.
    expect(classe).toBeDefined();
    expect(classe.value).toBe('1700.00');
    expect(classe.is_cash).toBe(false);
    expect(numero(classe.returns[3])).toBeCloseTo(15.96, 0);
  });

  it('provento recebido é rendimento da classe; amortização é devolução de capital', async () => {
    await historiaDoLongo();
    await posicao(itub4, '2026-03-31', '1000.00');
    await posicao(itub4, '2026-06-30', '1000.00');
    await lancar(2, 'payout', '2026-05-15', '100.00', 'dividend');

    const comProvento = (await desempenho(doLongo())).body.breakdown.classes[0];

    expect(numero(comProvento.returns[3])).toBeCloseTo(10, 0);

    await harness.sql`DELETE FROM transaction`;
    await harness.sql`DELETE FROM position_daily WHERE position_date = '2026-06-30'`;
    await posicao(itub4, '2026-06-30', '900.00');
    await lancar(3, 'payout', '2026-05-15', '100.00', 'amortization');

    const comAmortizacao = (await desempenho(doLongo())).body.breakdown.classes[0];

    // Devolveu 100 e a posição caiu 100: o capital voltou, nada foi ganho.
    expect(numero(comAmortizacao.returns[3])).toBeCloseTo(0, 0);
  });
});

describe('GET /api/performance · casos limite', () => {
  it('sem nenhum fechamento responde vazio, no contrato, sem erro', async () => {
    const response = await desempenho('?on_date=2026-06-30');

    expect(response.status).toBe(200);
    expect(() => performanceSchema.parse(response.body)).not.toThrow();
    expect(response.body.reference_date).toBeNull();
    expect(response.body.chart.dates).toEqual([]);
    expect(response.body.monthly.years).toEqual([]);
    expect(response.body.decomposition.rows).toEqual([]);
    expect(response.body.decomposition.total).toBeNull();
  });

  it('carteira que não existe é 404', async () => {
    const response = await desempenho(
      '?portfolio_id=0191e5a0-0000-7000-8000-00000000ffff&on_date=2026-06-30',
    );

    expect(response.status).toBe(404);
  });

  it('sem carteira a rota recusa com 400', async () => {
    const response = await request(harness.app).get(
      '/api/performance?on_date=2026-06-30',
    );

    expect(response.status).toBe(400);
  });

  it('benchmark malformado em benchmarks é 400', async () => {
    const response = await desempenho(`?portfolio_id=${longo}&benchmarks=nao-e-indice`);

    expect(response.status).toBe(400);
  });

  it('data antes do primeiro fechamento não inventa retorno', async () => {
    await historiaDoLongo();

    const response = await desempenho(`?portfolio_id=${longo}&on_date=2026-01-15`);

    expect(response.status).toBe(200);
    expect(response.body.reference_date).toBeNull();
    expect(
      response.body.windows.rows.every((row: { values: unknown[] }) =>
        row.values.every((value) => value === null),
      ),
    ).toBe(true);
  });
});
