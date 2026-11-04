import { Decimal } from 'decimal.js';

import { monthlyRate } from './projection.js';

/**
 * O plano de aportes de **vários** objetivos: dado quanto sobra por mês, para
 * onde vai cada real e quando cada meta fecha.
 *
 * Os objetivos são de carteiras diferentes, e o dinheiro de uma não migra para
 * a outra: o que o plano distribui é o aporte **futuro**. Por isso a conta é
 * mês a mês — cada carteira cresce à própria taxa e recebe a própria parcela —,
 * e não uma soma de fórmulas fechadas, que não enxerga o aporte liberado
 * quando uma meta fecha.
 *
 * ## Três escolhas, todas declaradas
 *
 * - **Distribuição proporcional** divide o aporte pelo peso de cada meta, que é
 *   o aporte necessário dela. **Por prioridade** enche as metas na ordem dada,
 *   cada uma até o necessário, e o que sobra vai para a primeira ainda aberta.
 * - **Cascata**: quando uma meta fecha, a parcela dela é redistribuída entre as
 *   abertas. Sem cascata, a parcela some — é o que acontece se nada for feito.
 * - **Aporte fixo**: cada meta recebe o próprio valor e nada é redistribuído.
 *   É o "ritmo atual" de cada carteira, sem plano nenhum.
 *
 * Todas as metas entram na **mesma moeda**: quem chama passa só metas em reais
 * de hoje, com a taxa real. Mistura de moedas é recusada antes de chegar aqui.
 */
const MONEY_DP = 2;

/** Cem anos. Além disso a resposta é "nunca", e não uma data. */
const MAX_MONTHS = 1200;

const Big = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

const zero = new Big(0);
const one = new Big(1);

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

export type PlanGoal = {
  readonly id: string;
  readonly current_value: string;
  readonly target_amount: string;
  /** A taxa real, ao ano, em %. */
  readonly annual_return_pct: string;
  /** O aporte que fecha a meta na data: o peso dela na divisão. */
  readonly required_monthly: string;
};

export type PlanAllocation =
  | {
      readonly kind: 'fixed';
      /** O aporte de cada meta, por id. Quem não aparece recebe zero. */
      readonly monthly: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: 'budget';
      readonly budget: string;
      readonly distribution: 'proportional' | 'priority';
      readonly cascade: boolean;
      /** A ordem de prioridade, por id. Quem não aparece vai ao fim, na ordem dada. */
      readonly priority?: readonly string[] | undefined;
    };

export type PlanGoalResult = {
  readonly id: string;
  /** A parcela do primeiro mês. */
  readonly monthly: string;
  /** Em quantos meses a meta fecha. Zero quando já está fechada; nulo quando não fecha em cem anos. */
  readonly months_to_arrival: number | null;
};

export type PlanResult = {
  readonly goals: readonly PlanGoalResult[];
  /**
   * Quando a última meta fecha, em meses. Nulo quando alguma não fecha em cem
   * anos: "todas as metas" não tem data se uma delas não tem.
   */
  readonly months_to_all: number | null;
  /**
   * A soma dos valores das carteiras limitada à meta de cada uma, no fim de
   * cada mês de zero a `months`: o quanto da meta somada está feito.
   */
  readonly series: readonly string[];
};

type Live = {
  readonly id: string;
  readonly rate: Decimal;
  readonly target: Decimal;
  readonly required: Decimal;
  value: Decimal;
  arrival: number | null;
  done: boolean;
};

const share = (budget: Decimal, weights: readonly Decimal[]): readonly Decimal[] => {
  const total = weights.reduce((sum, weight) => sum.plus(weight), zero);

  if (total.isZero()) {
    return weights.map(() => budget.dividedBy(Math.max(weights.length, 1)));
  }

  return weights.map((weight) => budget.times(weight).dividedBy(total));
};

const proportional = (budget: Decimal, open: readonly Live[]): Map<string, Decimal> =>
  new Map(
    share(
      budget,
      open.map((goal) => goal.required),
    ).map((amount, index) => [open[index]?.id ?? '', amount] as const),
  );

const byPriority = (
  budget: Decimal,
  open: readonly Live[],
  order: readonly string[],
): Map<string, Decimal> => {
  const rank = (id: string): number => {
    const index = order.indexOf(id);

    return index === -1 ? order.length : index;
  };

  const sorted = [...open].sort((left, right) => rank(left.id) - rank(right.id));
  const amounts = new Map<string, Decimal>();
  let left = budget;

  for (const goal of sorted) {
    const given = Decimal.min(goal.required, left);

    amounts.set(goal.id, given);
    left = left.minus(given);
  }

  const first = sorted[0];

  if (first !== undefined && left.isPositive()) {
    amounts.set(first.id, (amounts.get(first.id) ?? zero).plus(left));
  }

  return amounts;
};

export const planGoals = (
  goals: readonly PlanGoal[],
  allocation: PlanAllocation,
  months: number,
): PlanResult => {
  const live: Live[] = goals.map((goal) => {
    const value = new Big(goal.current_value);
    const target = new Big(goal.target_amount);
    const done = value.greaterThanOrEqualTo(target);

    return {
      id: goal.id,
      rate: monthlyRate(goal.annual_return_pct),
      target,
      required: new Big(goal.required_monthly),
      value,
      arrival: done ? 0 : null,
      done,
    };
  });

  const allocate = (open: readonly Live[]): Map<string, Decimal> => {
    if (allocation.kind === 'fixed') {
      return new Map(
        open.map(
          (goal) => [goal.id, new Big(allocation.monthly[goal.id] ?? '0')] as const,
        ),
      );
    }

    const budget = new Big(allocation.budget);

    return allocation.distribution === 'proportional'
      ? proportional(budget, open)
      : byPriority(budget, open, allocation.priority ?? []);
  };

  const capped = (): Decimal =>
    live.reduce((sum, goal) => sum.plus(Decimal.min(goal.value, goal.target)), zero);

  const open = (): Live[] => live.filter((goal) => !goal.done);

  const first = allocate(open());
  const series: string[] = [money(capped())];

  const cascade = allocation.kind === 'budget' && allocation.cascade;
  let current = first;

  for (let month = 1; month <= MAX_MONTHS; month += 1) {
    const active = open();
    if (active.length === 0 && month > months) break;

    if (cascade) current = allocate(active);

    for (const goal of active) {
      goal.value = goal.value
        .times(one.plus(goal.rate))
        .plus(current.get(goal.id) ?? zero);

      if (goal.value.greaterThanOrEqualTo(goal.target)) {
        goal.done = true;
        goal.arrival = month;
      }
    }

    if (month <= months) series.push(money(capped()));
  }

  while (series.length <= months) series.push(money(capped()));

  const arrivals = live.map((goal) => goal.arrival);

  return {
    goals: live.map((goal) => ({
      id: goal.id,
      monthly: money(first.get(goal.id) ?? zero),
      months_to_arrival: goal.arrival,
    })),
    months_to_all: arrivals.some((arrival) => arrival === null)
      ? null
      : Math.max(0, ...arrivals.map((arrival) => arrival ?? 0)),
    series,
  };
};
