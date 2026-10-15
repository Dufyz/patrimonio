import { goalsSchema } from '@patrimonio/contracts';
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
const CASA = '019b0000-0000-7000-8000-0000000000a2';
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
  request(harness.app).get(`/api/goals?on_date=${HOJE}&portfolio_id=${portfolio}${query}`);

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
  it('sem objetivos responde lista vazia, dentro do contrato', async () => {
    const response = await objetivos();

    expect(response.status).toBe(200);
    expect(() => goalsSchema.parse(response.body)).not.toThrow();
    expect(response.body.reference_date).toBe(HOJE);
    expect(response.body.scope.portfolio_id).toBe(longo);
    expect(response.body.goals).toEqual([]);
  });

  it('projeta com a taxa da premissa e a declara', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Independência financeira', longo);

    const response = await objetivos();
    expect(response.status).toBe(200);
    const parsed = goalsSchema.parse(response.body);

    const [meta] = parsed.goals;
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

  it('a taxa do pedido troca a da premissa e marca a projeção como alterada', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Independência financeira', longo);

    const base = goalsSchema.parse((await objetivos()).body).goals[0];
    const alterada = goalsSchema.parse(
      (await objetivos(`&rates=${INDEPENDENCIA}:3`)).body,
    ).goals[0];

    expect(alterada?.rate).toMatchObject({
      used_pct: '3.00',
      declared_pct: '6.00',
      overridden: true,
    });
    expect(Number(alterada?.projection?.required_monthly)).toBeGreaterThan(
      Number(base?.projection?.required_monthly),
    );
  });

  it('cada carteira traz só os objetivos dela, e a que não existe responde 404', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Independência financeira', longo);
    await objetivo(RESERVA_GOAL, 'Reserva de emergência', reserva, {
      date: '2027-06-30',
    });

    const doLongo = goalsSchema.parse((await objetivos()).body);
    expect(doLongo.scope).toMatchObject({ portfolio_id: longo, name: 'Longo prazo' });
    expect(doLongo.goals.map((meta) => meta.name)).toEqual(['Independência financeira']);

    const daReserva = goalsSchema.parse((await objetivos('', reserva)).body);
    expect(daReserva.goals.map((meta) => meta.name)).toEqual(['Reserva de emergência']);

    const ausente = await objetivos('', '019b0000-0000-7000-8000-0000000000ff');
    expect(ausente.status).toBe(404);
  });

  it('exige a carteira', async () => {
    const response = await request(harness.app).get(`/api/goals?on_date=${HOJE}`);

    expect(response.status).toBe(400);
  });

  it('sem premissa, ou com premissa ilegível, a projeção fica bloqueada e diz por quê', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Sem premissa', longo, { assumption: null });
    await objetivo(CASA, 'Premissa ilegível', longo, {
      assumption: 'tesouro quando der',
    });

    const { goals } = goalsSchema.parse((await objetivos()).body);
    const por = (name: string) => goals.find((meta) => meta.name === name);

    expect(por('Sem premissa')).toMatchObject({
      blocked: 'no_assumption',
      projection: null,
      chart: null,
      status: 'no_projection',
    });
    expect(por('Premissa ilegível')).toMatchObject({
      blocked: 'unrecognized_assumption',
      projection: null,
    });
    // O progresso não depende da taxa: continua honesto.
    expect(por('Sem premissa')?.progress_pct).not.toBe('0.00');
  });

  it('objetivo já atingido não projeta nada', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Entrada do carro', longo, { target: '50000.00' });

    const [meta] = goalsSchema.parse((await objetivos()).body).goals;

    expect(meta?.status).toBe('reached');
    expect(meta?.progress_pct).toBe('100.00');
    expect(meta?.remaining_brl).toBe('0.00');
    expect(meta?.surplus_brl).toBe('62000.00');
  });

  it('prazo vencido sem a meta é atrasado, não uma projeção para o passado', async () => {
    await historia();
    await objetivo(INDEPENDENCIA, 'Viagem', longo, { target: '500000.00', date: '2026-03-01' });

    const [meta] = goalsSchema.parse((await objetivos()).body).goals;

    expect(meta?.status).toBe('overdue');
    expect(meta?.months_remaining).toBe(0);
  });

  it('recusa taxa malformada com 400', async () => {
    for (const rates of ['abc', `${INDEPENDENCIA}:abc`, `${INDEPENDENCIA}:150`]) {
      const response = await objetivos(`&rates=${rates}`);
      expect(response.status).toBe(400);
    }
  });
});
