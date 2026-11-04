import { describe, expect, it } from 'vitest';

import { planGoals } from './plan.js';
import type { PlanGoal } from './plan.js';
import { arrivalMonth } from './projection.js';

const reserve: PlanGoal = {
  id: 'reserva',
  current_value: '140000.00',
  target_amount: '180000.00',
  annual_return_pct: '5',
  required_monthly: '1000.00',
};

const independence: PlanGoal = {
  id: 'independencia',
  current_value: '55000.00',
  target_amount: '400000.00',
  annual_return_pct: '6',
  required_monthly: '6000.00',
};

const alone = (goal: PlanGoal, monthly: string): number | null =>
  arrivalMonth({
    reference_date: '2026-01-01',
    current_value: goal.current_value,
    target_amount: goal.target_amount,
    target_date: '2099-01-01',
    amount_in_today_brl: false,
    annual_return_pct: goal.annual_return_pct,
    monthly_contribution: monthly,
  });

describe('o plano com aporte fixo', () => {
  it('fecha cada meta no mesmo mês em que ela fecharia sozinha', () => {
    const plan = planGoals(
      [reserve, independence],
      { kind: 'fixed', monthly: { reserva: '1000.00', independencia: '6000.00' } },
      12,
    );

    expect(plan.goals.map((goal) => goal.months_to_arrival)).toEqual([
      alone(reserve, '1000.00'),
      alone(independence, '6000.00'),
    ]);
  });

  it('não fecha em cem anos quando a meta não recebe aporte e o retorno não basta', () => {
    const plan = planGoals(
      [{ ...independence, current_value: '1000.00', annual_return_pct: '0' }],
      { kind: 'fixed', monthly: {} },
      6,
    );

    expect(plan.goals[0]?.months_to_arrival).toBeNull();
    expect(plan.months_to_all).toBeNull();
  });
});

describe('o plano com orçamento', () => {
  const budget = {
    kind: 'budget',
    budget: '7000.00',
    distribution: 'proportional',
    cascade: false,
  } as const;

  it('divide o orçamento na proporção do aporte necessário', () => {
    const plan = planGoals([reserve, independence], budget, 12);

    expect(plan.goals.map((goal) => goal.monthly)).toEqual(['1000.00', '6000.00']);
  });

  it('com a cascata, o aporte da meta fechada vai para as outras e a última fecha antes', () => {
    const without = planGoals([reserve, independence], budget, 12);
    const withCascade = planGoals(
      [reserve, independence],
      { ...budget, cascade: true },
      12,
    );

    const closed = (plan: typeof without): number =>
      plan.goals.find((goal) => goal.id === 'independencia')?.months_to_arrival ??
      Infinity;

    expect(closed(withCascade)).toBeLessThan(closed(without));
    // A que fecha primeiro não muda: a cascata só mexe no que vem depois.
    expect(withCascade.goals[0]?.months_to_arrival).toBe(
      without.goals[0]?.months_to_arrival,
    );
  });

  it('um orçamento maior nunca fecha a última meta depois', () => {
    const small = planGoals(
      [reserve, independence],
      { ...budget, budget: '5000.00' },
      12,
    );
    const large = planGoals(
      [reserve, independence],
      { ...budget, budget: '10000.00' },
      12,
    );

    expect(large.months_to_all).toBeLessThan(small.months_to_all ?? Infinity);
  });

  it('por prioridade, enche a primeira meta antes de dar à segunda', () => {
    const plan = planGoals(
      [reserve, independence],
      {
        kind: 'budget',
        budget: '3000.00',
        distribution: 'priority',
        cascade: false,
        priority: ['independencia', 'reserva'],
      },
      12,
    );

    expect(plan.goals.map((goal) => goal.monthly)).toEqual(['0.00', '3000.00']);
  });

  it('o que sobra depois de encher todas vai para a primeira da fila', () => {
    const plan = planGoals(
      [reserve, independence],
      {
        kind: 'budget',
        budget: '8000.00',
        distribution: 'priority',
        cascade: false,
        priority: ['reserva', 'independencia'],
      },
      12,
    );

    expect(plan.goals.map((goal) => goal.monthly)).toEqual(['2000.00', '6000.00']);
  });
});

describe('a série somada', () => {
  it('começa no que já está feito e termina na meta somada', () => {
    const plan = planGoals(
      [reserve, independence],
      { kind: 'budget', budget: '7000.00', distribution: 'proportional', cascade: true },
      400,
    );

    expect(plan.series).toHaveLength(401);
    expect(plan.series[0]).toBe('195000.00');
    expect(plan.series.at(-1)).toBe('580000.00');
  });

  it('nunca passa da meta somada nem diminui', () => {
    const plan = planGoals(
      [reserve, independence],
      { kind: 'budget', budget: '20000.00', distribution: 'proportional', cascade: true },
      60,
    );

    const values = plan.series.map(Number);

    expect(Math.max(...values)).toBeLessThanOrEqual(580_000);
    expect(
      values.every((value, index) => index === 0 || value >= (values[index - 1] ?? 0)),
    ).toBe(true);
  });
});

describe('metas já fechadas', () => {
  it('contam como fechadas no mês zero e não recebem aporte', () => {
    const done: PlanGoal = { ...reserve, current_value: '200000.00' };
    const plan = planGoals(
      [done, independence],
      { kind: 'budget', budget: '6000.00', distribution: 'proportional', cascade: false },
      6,
    );

    expect(plan.goals[0]).toEqual({
      id: 'reserva',
      monthly: '0.00',
      months_to_arrival: 0,
    });
    expect(plan.goals[1]?.monthly).toBe('6000.00');
  });
});
