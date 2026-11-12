import {
  goalsOverviewSchema,
  goalsSchema,
  previewGoalResponseSchema,
} from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * A tela de Objetivos, pela rota, contra Postgres de verdade.
 *
 * O relógio do harness é o do sistema, então todo pedido leva `on_date`: o
 * teste não pode depender do dia em que roda. O que está sob teste é a leitura
 * inteira — banco, caso de uso, cálculo, contrato — e principalmente o que a
 * tela **não** inventa: sem premissa entendida não há taxa, e sem taxa não há
 * projeção.
 */
let harness: ApiHarness;
let longo: string;
let reserva: string;

const HOJE = '2026-06-30';
const INDEPENDENCIA = '019b0000-0000-7000-8000-0000000000a1';
const RESERVA_GOAL = '019b0000-0000-7000-8000-0000000000a3';

const fechar = async (
  portfolio: string,
  date: string,
  total: string,
  netFlow = '0.00',
): Promise<void> => {
  await harness.sql`
    INSERT INTO portfolio_daily (
      portfolio_id, position_date, total_value, net_flow, income, payouts,
      quota_value, quota_count, cumulative_contributions
    )
    VALUES (
      ${portfolio}, ${date}, ${total}, ${netFlow}, '0.00', '0.00',
      '1.000000000000', ${total}, '0.00'
    )
  `;
};

const objetivo = async (
  id: string,
  name: string,
  portfolio: string,
  options: {
    readonly target?: string;
    readonly date?: string;
    readonly assumption?: string | null;
    readonly createdAt?: string;
  } = {},
): Promise<void> => {
  await harness.sql`
    INSERT INTO goal (
      id, name, portfolio_id, target_amount, target_date, return_assumption,
      amount_in_today_brl, created_at
    )
    VALUES (
      ${id}, ${name}, ${portfolio}, ${options.target ?? '1500000.00'}, ${options.date ?? '2040-01-01'},
      ${options.assumption === undefined ? 'IPCA+6' : options.assumption},
      TRUE, ${options.createdAt ?? '2026-01-01T12:00:00Z'}
    )
  `;
};

/** Seis meses fechados, com aporte de 2.000 por mês: 100.000 → 112.000. */
const historia = async (): Promise<void> => {
  const meses = [
    ['2026-01-30', '100000.00'],
    ['2026-02-27', '102000.00'],
    ['2026-03-31', '104000.00'],
    ['2026-04-30', '106000.00'],
    ['2026-05-29', '108000.00'],
    ['2026-06-30', '112000.00'],
  ] as const;

  for (const [date, total] of meses) {
    await fechar(longo, date, total, '2000.00');
  }
};

const objetivos = async (
  query = '',
  portfolio: string = longo,
): Promise<request.Response> =>
  request(harness.app).get(
    `/api/goals?on_date=${HOJE}&portfolio_id=${portfolio}${query}`,
  );

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);
  await harness.sql`DELETE FROM portfolio_daily`;

  const criada = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Longo prazo' });
  longo = criada.body.portfolio.id;

  const outra = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Reserva' });
  reserva = outra.body.portfolio.id;
});

describe('GET /api/goals', () => {
  it('sem objetivo responde nulo, dentro do contrato', async () => {
    const response = await objetivos();

    expect(response.status).toBe(200);
    expect(() => goalsSchema.parse(response.body)).not.toThrow();
    expect(response.body.reference_date).toBe(HOJE);
    expect(response.body.scope.portfolio_id).toBe(longo);
    expect(response.body.goal).toBeNull();
  });

  it('projeta com a taxa da premissa e a declara', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Independência financeira', longo);

    const response = await objetivos();
    expect(response.status).toBe(200);
    const parsed = goalsSchema.parse(response.body);

    const meta = parsed.goal;
    expect(meta?.name).toBe('Independência financeira');
    expect(meta?.current_value).toBe('112000.00');
    expect(meta?.rate).toMatchObject({
      assumption: 'IPCA+6',
      kind: 'ipca_plus',
      used_pct: '6.00',
      basis: 'real',
      overridden: false,
    });
    expect(meta?.pace.months_measured).toBeGreaterThan(0);
    expect(meta?.projection).not.toBeNull();
    expect(meta?.chart?.dates.length).toBe(meta?.chart?.pace.length);
    expect(meta?.contributions.some((row) => row.kind === 'required')).toBe(true);
  });

  it('"No ritmo" é o acumulado ter alcançado a marca de hoje; senão, "Abaixo do ritmo" (OBJ-04)', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Independência financeira', longo);

    const meta = goalsSchema.parse((await objetivos()).body).goal;
    expect(meta?.expected_pct).not.toBeNull();
    const alcancou = Number(meta?.progress_pct) >= Number(meta?.expected_pct);
    expect(meta?.status).toBe(alcancou ? 'on_track' : 'behind');

    // Uma meta muito mais alta que a trajetória: o acumulado fica abaixo da marca.
    await harness.sql`UPDATE goal SET target_amount = '9000000.00' WHERE id = ${INDEPENDENCIA}`;
    const alta = goalsSchema.parse((await objetivos()).body).goal;
    expect(
      alta?.status ===
        (Number(alta?.progress_pct) >= Number(alta?.expected_pct)
          ? 'on_track'
          : 'behind'),
    ).toBe(true);
  });

  it('a taxa do pedido troca a da premissa e marca a projeção como alterada', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Independência financeira', longo);

    const base = goalsSchema.parse((await objetivos()).body).goal;
    const alterada = goalsSchema.parse((await objetivos('&rate=3')).body).goal;

    expect(alterada?.rate).toMatchObject({
      used_pct: '3.00',
      declared_pct: '6.00',
      overridden: true,
    });
    expect(Number(alterada?.projection?.required_monthly)).toBeGreaterThan(
      Number(base?.projection?.required_monthly),
    );
  });

  it('cada carteira traz só o objetivo dela, e a que não existe responde 404', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Independência financeira', longo);
    await objetivo(RESERVA_GOAL, 'Reserva de emergência', reserva, {
      date: '2027-06-30',
    });

    const doLongo = goalsSchema.parse((await objetivos()).body);
    expect(doLongo.scope).toMatchObject({ portfolio_id: longo, name: 'Longo prazo' });
    expect(doLongo.goal?.name).toBe('Independência financeira');

    const daReserva = goalsSchema.parse((await objetivos('', reserva)).body);
    expect(daReserva.goal?.name).toBe('Reserva de emergência');

    const ausente = await objetivos('', '019b0000-0000-7000-8000-0000000000ff');
    expect(ausente.status).toBe(404);
  });

  it('exige a carteira', async () => {
    const response = await request(harness.app).get(`/api/goals?on_date=${HOJE}`);

    expect(response.status).toBe(400);
  });

  it('sem premissa a projeção fica bloqueada e diz por quê', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Sem premissa', longo, { assumption: null });

    const { goal } = goalsSchema.parse((await objetivos()).body);

    expect(goal).toMatchObject({
      blocked: 'no_assumption',
      projection: null,
      chart: null,
      status: 'no_projection',
    });
    // O progresso não depende da taxa: continua honesto.
    expect(goal?.progress_pct).not.toBe('0.00');
  });

  it('com premissa ilegível a projeção também fica bloqueada', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Premissa ilegível', longo, {
      assumption: 'tesouro quando der',
    });

    const { goal } = goalsSchema.parse((await objetivos()).body);

    expect(goal).toMatchObject({ blocked: 'unrecognized_assumption', projection: null });
  });

  it('objetivo já atingido não projeta nada', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Entrada do carro', longo, { target: '50000.00' });

    const meta = goalsSchema.parse((await objetivos()).body).goal;

    expect(meta?.status).toBe('reached');
    expect(meta?.progress_pct).toBe('100.00');
    expect(meta?.remaining_brl).toBe('0.00');
    expect(meta?.surplus_brl).toBe('62000.00');
  });

  it('prazo vencido sem a meta é atrasado, não uma projeção para o passado', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Viagem', longo, {
      target: '500000.00',
      date: '2026-03-01',
    });

    const meta = goalsSchema.parse((await objetivos()).body).goal;

    expect(meta?.status).toBe('overdue');
    expect(meta?.months_remaining).toBe(0);
  });

  it('recusa taxa malformada com 400', async () => {
    for (const rate of ['abc', '-1', '150', '6.12345']) {
      const response = await objetivos(`&rate=${rate}`);
      expect(response.status).toBe(400);
    }
  });
});

const CORPO = {
  name: 'Independência financeira',
  target_amount: '1500000.00',
  target_date: '2040-01-01',
  return_assumption: 'IPCA+6',
  amount_in_today_brl: true,
};

const gravar = (portfolio: string, body: Record<string, unknown> = CORPO) =>
  request(harness.app).put(`/api/portfolios/${portfolio}/goal`).send(body);

const quantos = async (portfolio: string): Promise<number> => {
  const [row] = await harness.sql<{ count: string }[]>`
    SELECT COUNT(*) AS count FROM goal WHERE portfolio_id = ${portfolio}
  `;
  return Number(row?.count);
};

describe('PUT /api/portfolios/:id/goal', () => {
  it('cria o objetivo da carteira e, na segunda vez, o edita: nunca são dois', async () => {
    const criado = await gravar(longo);
    expect(criado.status).toBe(201);
    expect(criado.body.goal).toMatchObject({ name: 'Independência financeira' });

    const editado = await gravar(longo, {
      ...CORPO,
      name: 'Liberdade',
      target_amount: '2000000.00',
    });
    expect(editado.status).toBe(200);
    expect(editado.body.goal.id).toBe(criado.body.goal.id);

    expect(await quantos(longo)).toBe(1);

    const { goal } = goalsSchema.parse((await objetivos()).body);
    expect(goal).toMatchObject({
      name: 'Liberdade',
      target_amount: '2000000.00',
      return_assumption: 'IPCA+6',
    });
  });

  it('cada carteira tem o seu', async () => {
    await gravar(longo);
    await gravar(reserva, { ...CORPO, name: 'Reserva', target_date: '2028-01-01' });

    expect(await quantos(longo)).toBe(1);
    expect(await quantos(reserva)).toBe(1);
  });

  it('recusa data que não é futura e premissa que a projeção não entende', async () => {
    const passada = await gravar(longo, { ...CORPO, target_date: '2020-01-01' });
    expect(passada.status).toBe(400);
    expect(passada.body.message).toMatch(/futura/);

    const ilegivel = await gravar(longo, {
      ...CORPO,
      return_assumption: 'tesouro quando der',
    });
    expect(ilegivel.status).toBe(400);
    expect(ilegivel.body.message).toMatch(/não foi entendida/);

    expect(await quantos(longo)).toBe(0);
  });

  it('recusa valor que não é positivo e corpo incompleto', async () => {
    expect((await gravar(longo, { ...CORPO, target_amount: '0' })).status).toBe(400);
    expect((await gravar(longo, { ...CORPO, name: '' })).status).toBe(400);
    expect((await gravar(longo, { name: 'Só o nome' })).status).toBe(400);
  });

  it('carteira que não existe responde 404', async () => {
    const response = await gravar('019b0000-0000-7000-8000-0000000000ff');

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/portfolios/:id/goal', () => {
  it('exclui o objetivo, e na segunda vez diz que não há', async () => {
    await gravar(longo);

    const primeira = await request(harness.app).delete(`/api/portfolios/${longo}/goal`);
    expect(primeira.status).toBe(200);
    expect(await quantos(longo)).toBe(0);

    const segunda = await request(harness.app).delete(`/api/portfolios/${longo}/goal`);
    expect(segunda.status).toBe(404);
  });

  it('não toca no objetivo de outra carteira', async () => {
    await gravar(longo);
    await gravar(reserva);

    await request(harness.app).delete(`/api/portfolios/${longo}/goal`);

    expect(await quantos(reserva)).toBe(1);
  });
});

describe('POST /api/portfolios/:id/goal/preview', () => {
  const prever = (body: Record<string, unknown> = {}, portfolio: string = longo) =>
    request(harness.app)
      .post(`/api/portfolios/${portfolio}/goal/preview`)
      .send({ ...CORPO, on_date: HOJE, ...body });

  it('projeta o objetivo do formulário pela mesma conta da tela, sem gravar', async () => {
    await historia();

    const response = await prever();
    expect(response.status).toBe(200);

    const { goal } = previewGoalResponseSchema.parse(response.body);
    expect(goal.current_value).toBe('112000.00');
    expect(goal.projection).not.toBeNull();
    expect(goal.return_assumption).toBe('IPCA+6');
    expect(await quantos(longo)).toBe(0);
  });

  it('com objetivo gravado, a prévia mede a nova meta e a tela segue mostrando a gravada', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Independência financeira', longo);

    const antes = goalsSchema.parse((await objetivos()).body).goal;
    const depois = previewGoalResponseSchema.parse(
      (await prever({ target_amount: '300000.00', target_date: '2032-01-01' })).body,
    ).goal;
    const depoisDaPrevia = goalsSchema.parse((await objetivos()).body).goal;

    expect(depois.target_amount).toBe('300000.00');
    expect(Number(depois.progress_pct)).toBeGreaterThan(Number(antes?.progress_pct));
    expect(depoisDaPrevia).toEqual(antes);
    expect(depois.created_on).toBe(antes?.created_on);
  });

  it('recusa o que o PUT recusaria', async () => {
    expect((await prever({ target_date: '2020-01-01' })).status).toBe(400);
    expect((await prever({ return_assumption: 'xyz' })).status).toBe(400);
  });

  it('carteira que não existe responde 404', async () => {
    const response = await prever({}, '019b0000-0000-7000-8000-0000000000ff');

    expect(response.status).toBe(404);
  });
});

describe('GET /api/goals/overview', () => {
  const panorama = async (query = ''): Promise<request.Response> =>
    request(harness.app).get(`/api/goals/overview?on_date=${HOJE}${query}`);

  /** Duas carteiras com história e um objetivo cada: o panorama tem o que somar. */
  const doisObjetivos = async (): Promise<void> => {
    await historia();
    for (const [date, total] of [
      ['2026-04-30', '40000.00'],
      ['2026-05-29', '41000.00'],
      ['2026-06-30', '42000.00'],
    ] as const) {
      await fechar(reserva, date, total, '1000.00');
    }

    await objetivo(INDEPENDENCIA, 'Independência financeira', longo, {
      target: '400000.00',
      date: '2034-06-30',
    });
    await objetivo(RESERVA_GOAL, 'Reserva de emergência', reserva, {
      target: '60000.00',
      date: '2028-06-30',
    });
  };

  it('sem objetivo lista as carteiras, sem nada para somar', async () => {
    const response = await panorama();

    expect(response.status).toBe(200);
    const parsed = goalsOverviewSchema.parse(response.body);

    expect(parsed.portfolios.map((row) => [row.portfolio_name, row.goal])).toEqual([
      ['Longo prazo', null],
      ['Reserva', null],
    ]);
    expect(parsed.totals).toMatchObject({
      goals: 0,
      counted: 0,
      required_monthly: '0.00',
    });
    expect(parsed.chart).toBeNull();
    expect(parsed.scenarios).toEqual([]);
  });

  it('soma o necessário, reparte em porcentagem e diz quando as metas fecham', async () => {
    await doisObjetivos();

    const parsed = goalsOverviewSchema.parse((await panorama()).body);
    const metas = parsed.portfolios.flatMap((row) =>
      row.goal === null ? [] : [row.goal],
    );

    expect(parsed.totals).toMatchObject({
      goals: 2,
      counted: 2,
      target_amount: '460000.00',
      current_value: '154000.00',
      remaining_brl: '306000.00',
      last_target_date: '2034-06-30',
    });

    const soma = metas.reduce((total, meta) => total + Number(meta.required_monthly), 0);
    expect(Number(parsed.totals.required_monthly)).toBeCloseTo(soma, 2);

    const fatias = metas.reduce(
      (total, meta) => total + Number(meta.required_share_pct),
      0,
    );
    expect(fatias).toBeCloseTo(100, 0);

    // Sem orçamento pedido, vale o necessário: cada meta fecha até o próprio prazo.
    expect(parsed.plan.budget).toBe(parsed.totals.required_monthly);
    expect(metas.every((meta) => meta.plan?.reaches_target_date === true)).toBe(true);
    expect(parsed.plan.months_vs_deadline).toBeLessThanOrEqual(0);

    expect(parsed.scenarios.filter((scenario) => scenario.selected)).toHaveLength(1);
    expect(parsed.scenarios.find((scenario) => scenario.selected)?.kind).toBe('required');
  });

  it('o gráfico traz as três trajetórias do mesmo tamanho e termina na meta somada', async () => {
    await doisObjetivos();

    const { chart } = goalsOverviewSchema.parse((await panorama()).body);

    expect(chart).not.toBeNull();
    expect(chart?.pace).toHaveLength(chart?.dates.length ?? -1);
    expect(chart?.required).toHaveLength(chart?.dates.length ?? -1);
    expect(chart?.plan).toHaveLength(chart?.dates.length ?? -1);
    expect(chart?.dates[0]).toBe(HOJE);
    expect(chart?.plan[0]).toBe('154000.00');
    expect(Number(chart?.required.at(-1))).toBeLessThanOrEqual(460_000);
  });

  it('um orçamento maior fecha antes e aparece como cenário escolhido', async () => {
    await doisObjetivos();

    const base = goalsOverviewSchema.parse((await panorama()).body);
    const maior = goalsOverviewSchema.parse(
      (await panorama(`&budget=${Number(base.plan.budget) * 2}`)).body,
    );

    expect(maior.plan.months_vs_deadline).toBeLessThan(base.plan.months_vs_deadline ?? 0);
    expect(maior.scenarios.filter((scenario) => scenario.selected)).toHaveLength(1);
    expect(maior.totals.required_monthly).toBe(base.totals.required_monthly);
  });

  it('o orçamento é dividido por prioridade quando pedido', async () => {
    await doisObjetivos();

    const response = await panorama(
      `&budget=1000&distribution=priority&cascade=false&priority=${reserva},${longo}`,
    );
    const parsed = goalsOverviewSchema.parse(response.body);
    const daReserva = parsed.portfolios.find((row) => row.portfolio_id === reserva)?.goal;
    const doLongo = parsed.portfolios.find((row) => row.portfolio_id === longo)?.goal;

    expect(parsed.plan).toMatchObject({ distribution: 'priority', cascade: false });
    expect(Number(daReserva?.plan?.monthly)).toBeGreaterThan(
      Number(doLongo?.plan?.monthly),
    );
    expect(Number(daReserva?.plan?.monthly) + Number(doLongo?.plan?.monthly)).toBeCloseTo(
      1000,
      2,
    );
  });

  it('meta em reais da data alvo sem IPCA para converter fica na tabela, com o motivo, e fora das somas', async () => {
    await doisObjetivos();
    await harness.sql`UPDATE goal SET amount_in_today_brl = FALSE WHERE id = ${RESERVA_GOAL}`;

    const parsed = goalsOverviewSchema.parse((await panorama()).body);
    const nominal = parsed.portfolios.find((row) => row.portfolio_id === reserva)?.goal;

    // `IPCA+6` numa meta nominal precisa do IPCA: sem ele, não há projeção.
    expect(nominal).toMatchObject({
      counted: false,
      excluded_reason: 'no_projection',
      blocked: 'no_inflation',
      required_monthly: null,
      plan: null,
    });
    expect(parsed.totals).toMatchObject({
      goals: 2,
      counted: 1,
      target_amount: '400000.00',
    });
  });

  it('premissa fixa numa meta nominal sem IPCA não se converte: fica fora, como nominal', async () => {
    await doisObjetivos();
    await harness.sql`
      UPDATE goal SET amount_in_today_brl = FALSE, return_assumption = '9'
       WHERE id = ${RESERVA_GOAL}
    `;

    const parsed = goalsOverviewSchema.parse((await panorama()).body);
    const nominal = parsed.portfolios.find((row) => row.portfolio_id === reserva)?.goal;

    expect(nominal).toMatchObject({ counted: false, excluded_reason: 'nominal' });
    expect(parsed.totals.counted).toBe(1);
  });

  it('meta em reais da data alvo é trazida a reais de hoje pelo IPCA e entra na soma', async () => {
    await doisObjetivos();
    await harness.sql`UPDATE goal SET amount_in_today_brl = FALSE WHERE id = ${RESERVA_GOAL}`;
    // Dois anos de IPCA de 2% cada: 4,04% em doze meses, cobrindo a janela inteira.
    await harness.sql`
      INSERT INTO index_quote (index_code, quote_date, daily_factor, source)
      VALUES ('IPCA', '2025-08-01', 1.02, 'teste'), ('IPCA', '2026-06-01', 1.02, 'teste')
    `;

    const parsed = goalsOverviewSchema.parse((await panorama()).body);
    const convertida = parsed.portfolios.find(
      (row) => row.portfolio_id === reserva,
    )?.goal;

    expect(convertida).toMatchObject({
      counted: true,
      excluded_reason: null,
      amount_in_today_brl: false,
      nominal_target_amount: '60000.00',
    });
    expect(Number(convertida?.target_amount)).toBeLessThan(60_000);
    expect(parsed.totals).toMatchObject({ counted: 2, inflation_pct: '4.04' });
    expect(Number(parsed.totals.target_amount)).toBeLessThan(460_000);
    expect(Number(parsed.totals.target_amount)).toBeCloseTo(
      400_000 + Number(convertida?.target_amount),
      2,
    );
  });

  it('recusa prioridade com id que não é de carteira', async () => {
    const response = await panorama('&priority=abc');

    expect(response.status).toBe(400);
  });
});
