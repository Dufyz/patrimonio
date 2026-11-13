import { projectionSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * PRJ-01/06 · A Projeção pela rota, contra Postgres de verdade: o plano é
 * gravado no servidor e o motor devolve a mesma série para a carteira e para o
 * total.
 */
let harness: ApiHarness;
let emergencia: string;
let investimentos: string;

const fechar = async (portfolio: string, total: string): Promise<void> => {
  await harness.sql`
    INSERT INTO portfolio_daily (
      portfolio_id, position_date, total_value, net_flow, income, payouts,
      quota_value, quota_count, cumulative_contributions
    )
    VALUES (
      ${portfolio}, '2026-01-30', ${total}, '0.00', '0.00', '0.00',
      '1.000000000000', ${total}, '0.00'
    )
  `;
};

const plano = (
  portfolio: string,
  body: {
    readonly expected_return_pct: string | null;
    readonly rules: readonly { amount: string; from: string; until: string | null }[];
  },
): request.Test =>
  request(harness.app).put(`/api/portfolios/${portfolio}/projection-plan`).send(body);

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);
  await harness.sql`DELETE FROM portfolio_daily`;
  await harness.sql`DELETE FROM projection_rule`;

  const a = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Emergência' });
  emergencia = a.body.portfolio.id;
  const b = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Investimentos' });
  investimentos = b.body.portfolio.id;
});

describe('GET /api/projection', () => {
  it('carteira sem plano usa 0,00% com aviso, e sem consolidação não projeta', async () => {
    await fechar(emergencia, '10000.00');

    const response = await request(harness.app).get('/api/projection');
    expect(response.status).toBe(200);
    const parsed = projectionSchema.parse(response.body);

    expect(parsed.horizon_months).toBe(24);
    const reserva = parsed.portfolios.find((item) => item.portfolio_id === emergencia);
    expect(reserva?.return_assumed_zero).toBe(true);
    expect(reserva?.projection?.series).toHaveLength(25);
    expect(reserva?.projection?.series[0]?.value).toBe('10000.00');
    expect(reserva?.projection?.kpis.at_horizon).toBe('10000.00');

    const nova = parsed.portfolios.find((item) => item.portfolio_id === investimentos);
    expect(nova?.projection).toBeNull();
  });

  it('grava rentabilidade e regras, e as regras de uma carteira somam', async () => {
    await fechar(emergencia, '10000.00');
    await fechar(investimentos, '20000.00');

    const salvo = await plano(emergencia, {
      expected_return_pct: '13.75',
      rules: [
        { amount: '1000.00', from: '2026-01', until: null },
        { amount: '500.00', from: '2026-01', until: null },
      ],
    });
    expect(salvo.status).toBe(200);

    const response = await request(harness.app).get(
      `/api/projection?portfolio_id=${emergencia}&horizon=12`,
    );
    const parsed = projectionSchema.parse(response.body);
    const item = parsed.portfolios[0];

    expect(parsed.portfolios).toHaveLength(1);
    expect(item?.expected_return_pct).toBe('13.75');
    expect(item?.return_assumed_zero).toBe(false);
    expect(item?.rules).toHaveLength(2);
    expect(item?.projection?.kpis.contributions).toBe('18000.00');
  });

  it('o total é a soma das carteiras projetadas', async () => {
    await fechar(emergencia, '10000.00');
    await fechar(investimentos, '20000.00');
    await plano(emergencia, { expected_return_pct: '10.00', rules: [] });
    await plano(investimentos, { expected_return_pct: '10.16', rules: [] });

    const parsed = projectionSchema.parse(
      (await request(harness.app).get('/api/projection?horizon=36')).body,
    );
    const soma = parsed.portfolios.reduce(
      (acc, item) => acc + Number(item.projection?.kpis.at_horizon ?? 0),
      0,
    );

    expect(parsed.total?.series[0]?.value).toBe('30000.00');
    expect(Number(parsed.total?.kpis.at_horizon)).toBeCloseTo(soma, 2);
  });

  it('recusa horizonte fora da lista e carteira desconhecida', async () => {
    expect((await request(harness.app).get('/api/projection?horizon=18')).status).toBe(
      400,
    );
    expect(
      (
        await request(harness.app).get(
          '/api/projection?portfolio_id=019b0000-0000-7000-8000-00000000ffff',
        )
      ).status,
    ).toBe(404);
  });
});

describe('PUT /api/portfolios/:id/projection-plan', () => {
  it('troca as regras anteriores em vez de acumular', async () => {
    await plano(emergencia, {
      expected_return_pct: '10.00',
      rules: [{ amount: '100.00', from: '2026-01', until: '2026-06' }],
    });
    await plano(emergencia, { expected_return_pct: null, rules: [] });

    const [{ total }] = await harness.sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM projection_rule WHERE portfolio_id = ${emergencia}
    `;
    expect(total).toBe('0');
  });

  it('recusa período invertido e carteira inexistente', async () => {
    const invertido = await plano(emergencia, {
      expected_return_pct: '10.00',
      rules: [{ amount: '100.00', from: '2026-06', until: '2026-01' }],
    });
    expect(invertido.status).toBe(400);

    const ausente = await plano('019b0000-0000-7000-8000-00000000ffff', {
      expected_return_pct: null,
      rules: [],
    });
    expect(ausente.status).toBe(404);
  });
});
