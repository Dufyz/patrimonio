import {
  addCalendarDays,
  addMonths,
  averageMonthlyContribution,
  contributionLadder,
  contributionTable,
  expectedProgress,
  factorToPct,
  goalStanding,
  goalTrajectory,
  monthOf,
  monthsBetween,
  nominalRate,
  normalizeRate,
  parseReturnAssumption,
  projectGoal,
  realRate,
  toMoney,
} from '@patrimonio/calc';
import type { GoalInput } from '@patrimonio/calc';
import type { DateOnly } from '@patrimonio/domain';
import { either, failure } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type {
  GoalInflationRow,
  GoalRepository,
  GoalRow,
} from '../../interfaces/goal.repository.js';

/**
 * T-07 · Onde o usuário diz quanto quer ter e quando, e a aplicação responde se
 * o ritmo atual chega lá.
 *
 * O caso de uso junta o que o banco leu — valores fechados e fluxos — e deixa a
 * conta com `packages/calc`. O que ele decide é o que a conta precisa para ser
 * honesta, e são quatro coisas:
 *
 * ## O ritmo é a média dos meses fechados, e só dos que existem
 *
 * A média de doze meses é a regra (C-10), e ela vale para quem tem doze meses de
 * história. Quem começou há quatro meses dividido por doze teria o ritmo
 * subestimado em dois terços, e a data de chegada empurrada para frente por um
 * erro de conta. O divisor é o número de meses que existem, até doze, e a
 * resposta o declara em `pace.months_measured`.
 *
 * O mês corrente fica de fora: um mês pela metade puxa a média para baixo no
 * dia dez e para cima no dia trinta. Só quando **toda** a história cabe no mês
 * corrente ele é o único que há, e entra.
 *
 * ## A taxa é declarada, e a moeda dela é a da meta
 *
 * Meta em reais de hoje usa a taxa **real**: patrimônio, meta e aporte na mesma
 * moeda, a meta uma linha reta. Meta em reais da data alvo usa a taxa
 * **nominal**; quando a premissa é `IPCA+x`, a nominal é a composta de x com o
 * IPCA dos últimos doze meses, que a resposta declara. Sem premissa entendida,
 * ou sem IPCA para uma meta nominal, **não há projeção** — e a resposta diz por
 * quê. Projetar com uma taxa adivinhada é o erro que esta tela existe para
 * evitar.
 *
 * ## Objetivo cumprido e objetivo vencido não projetam
 *
 * Quem já tem o valor não precisa de trajetória, e quem passou do prazo sem ter
 * não tem mais data a cumprir: o que resta é decidir entre estender o prazo e
 * encerrar o objetivo. O progresso, o que falta e o excedente continuam sendo
 * dados.
 *
 * ## "Esperado hoje" parte do começo do objetivo
 *
 * É a marca da barra de progresso: onde o objetivo estaria hoje se o aporte que
 * fecha a meta tivesse sido feito desde o primeiro dia. A trajetória tracejada do
 * gráfico é outra coisa — parte de hoje e responde "o que falta daqui para
 * frente".
 */
export type GetGoalsDeps = {
  readonly goals: GoalRepository;
  readonly clock: Clock;
};

export type GetGoalsInput = {
  readonly portfolio_id: string;
  readonly on_date?: DateOnly | undefined;
  /** A taxa ao ano, no lugar da premissa guardada. */
  readonly rate?: string | undefined;
  /**
   * A rentabilidade nominal ao ano, como a "esperada" da Projeção: no lugar da
   * premissa e sem pedir ao usuário que pense em IPCA. Vale sobre `rate`.
   */
  readonly nominal_rate?: string | undefined;
  /** Um aporte mensal a simular: entra na tabela e no gráfico, sem gravar nada. */
  readonly monthly?: string | undefined;
};

export type EvaluateOptions = {
  readonly nominal?: string | undefined;
  readonly monthly?: string | undefined;
};

export type GoalStatus = 'on_track' | 'behind' | 'overdue' | 'reached' | 'no_projection';

export type GoalBlock =
  'no_assumption' | 'unrecognized_assumption' | 'no_inflation' | 'no_history';

export type GoalRate = {
  readonly assumption: string | null;
  readonly kind: 'ipca_plus' | 'fixed';
  readonly used_pct: string;
  readonly basis: 'real' | 'nominal';
  readonly declared_pct: string | null;
  readonly overridden: boolean;
  readonly inflation_pct: string | null;
  /** A premissa guardada como taxa nominal ao ano. Nulo sem IPCA para convertê-la. */
  readonly premise_pct: string | null;
  /** A taxa em uso como nominal ao ano. Nulo sem IPCA para convertê-la. */
  readonly nominal_pct: string | null;
};
type BaseRate = Omit<GoalRate, 'premise_pct' | 'nominal_pct'>;

export type GoalPace = {
  readonly monthly_contribution: string;
  readonly months_measured: number;
};

export type GoalProjectionResult = {
  readonly projected_amount: string;
  readonly required_monthly: string;
  readonly arrival_date: DateOnly | null;
  readonly months_to_arrival: number | null;
  readonly gap_brl: string;
  readonly on_track: boolean;
};

export type GoalChart = {
  readonly dates: readonly DateOnly[];
  readonly pace: readonly string[];
  readonly required: readonly string[];
  /** Com o aporte simulado. Nulo sem simulação. */
  readonly plan: readonly string[] | null;
};

export type GoalContributionRow = {
  readonly monthly_contribution: string;
  readonly kind: 'current' | 'required' | 'option' | 'custom';
  /** Verdadeiro para o aporte simulado. */
  readonly selected: boolean;
  readonly arrival_date: DateOnly | null;
  readonly months_to_arrival: number | null;
  readonly reaches_target_date: boolean;
};

export type GoalResult = {
  readonly id: string;
  readonly name: string;
  readonly target_amount: string;
  readonly target_date: DateOnly;
  readonly amount_in_today_brl: boolean;
  readonly return_assumption: string | null;
  readonly created_on: DateOnly;
  readonly current_value: string;
  readonly as_of: DateOnly | null;
  readonly progress_pct: string;
  readonly remaining_brl: string;
  readonly surplus_brl: string | null;
  readonly expected_pct: string | null;
  readonly status: GoalStatus;
  readonly months_remaining: number;
  readonly blocked: GoalBlock | null;
  readonly rate: GoalRate | null;
  readonly pace: GoalPace;
  readonly projection: GoalProjectionResult | null;
  readonly chart: GoalChart | null;
  readonly contributions: readonly GoalContributionRow[];
};

export type GoalsResult = {
  readonly reference_date: DateOnly;
  readonly scope: { readonly portfolio_id: string; readonly name: string };
  readonly goal: GoalResult | null;
};

const PACE_MONTHS = 12;
/** O IPCA de um ano inteiro: quase o ano, porque a divulgação tem atraso. */
const INFLATION_GRACE_DAYS = 45;

const monthIndex = (month: string): number =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

/**
 * O ritmo: a média de aporte por mês nos meses fechados que existem, até doze.
 * Ver o texto do caso de uso para o que entra e o que fica de fora.
 */
const paceOf = (row: GoalRow, reference: DateOnly): GoalPace => {
  if (row.history_start === null) {
    return { monthly_contribution: '0.00', months_measured: 0 };
  }

  const current = monthIndex(monthOf(reference));
  const closedMonths = current - monthIndex(monthOf(row.history_start));

  const window = closedMonths >= 1 ? Math.min(PACE_MONTHS, closedMonths) : 1;
  const first = closedMonths >= 1 ? current - window : current;
  const last = closedMonths >= 1 ? current - 1 : current;

  const flows = row.flows
    .filter((flow) => {
      const index = monthIndex(flow.month);
      return index >= first && index <= last;
    })
    .map((flow) => ({ month: flow.month, net_flow: flow.net_flow }));

  return {
    monthly_contribution: averageMonthlyContribution(flows, window),
    months_measured: window,
  };
};

/**
 * O IPCA dos últimos doze meses, ou nada. Cobertura pela metade — três meses de
 * índice no banco — daria um percentual de três meses chamado de anual.
 */
export const inflationOf = (
  inflation: GoalInflationRow,
  reference: DateOnly,
): string | null => {
  if (inflation.factor === null) return null;
  if (inflation.first_date === null || inflation.last_date === null) return null;

  const from = addCalendarDays(addMonths(reference, -12), INFLATION_GRACE_DAYS);
  const to = addCalendarDays(reference, -INFLATION_GRACE_DAYS);

  if (inflation.first_date > from || inflation.last_date < to) return null;

  return factorToPct(inflation.factor);
};

type RateOutcome =
  | { readonly kind: 'rate'; readonly rate: GoalRate }
  | { readonly kind: 'blocked'; readonly block: GoalBlock; readonly rate: null };

type BaseOutcome =
  | { readonly kind: 'rate'; readonly rate: BaseRate }
  | { readonly kind: 'blocked'; readonly block: GoalBlock; readonly rate: null };

/** Taxa real abaixo de zero não cabe numa premissa escrita: a simulação para em zero. */
export const nonNegativeRate = (rate: string): string =>
  rate.startsWith('-') ? '0.00' : rate;

/**
 * A premissa guardada como taxa nominal ao ano. `IPCA+x` e metas em reais de
 * hoje guardam taxa real, que vira nominal pelo IPCA; taxa fixa em meta nominal
 * já é nominal.
 */
export const premiseNominal = (row: GoalRow, inflation: string | null): string | null => {
  const parsed = parseReturnAssumption(row.return_assumption);
  if (parsed === null) return null;

  const real = row.amount_in_today_brl || parsed.kind === 'ipca_plus';
  if (!real) return parsed.rate_pct;

  return inflation === null ? null : nominalRate(parsed.rate_pct, inflation);
};

const baseRateOf = (
  row: GoalRow,
  override: string | undefined,
  inflation: string | null,
): BaseOutcome => {
  const parsed = parseReturnAssumption(row.return_assumption);

  if (parsed === null && override === undefined) {
    return {
      kind: 'blocked',
      block: row.return_assumption === null ? 'no_assumption' : 'unrecognized_assumption',
      rate: null,
    };
  }

  const kind = parsed?.kind ?? 'fixed';
  const declared = parsed === null ? null : parsed.rate_pct;
  const typed = override === undefined ? null : normalizeRate(override);
  const chosen = typed ?? declared ?? '0.00';

  const common = {
    assumption: row.return_assumption,
    kind,
    declared_pct: declared,
    overridden: typed !== null && typed !== declared,
  } as const;

  if (row.amount_in_today_brl) {
    return {
      kind: 'rate',
      rate: { ...common, used_pct: chosen, basis: 'real', inflation_pct: null },
    };
  }

  if (kind === 'ipca_plus') {
    if (inflation === null) return { kind: 'blocked', block: 'no_inflation', rate: null };

    return {
      kind: 'rate',
      rate: {
        ...common,
        used_pct: nominalRate(chosen, inflation),
        basis: 'nominal',
        inflation_pct: inflation,
      },
    };
  }

  return {
    kind: 'rate',
    rate: { ...common, used_pct: chosen, basis: 'nominal', inflation_pct: null },
  };
};

const rateOf = (
  row: GoalRow,
  override: string | undefined,
  inflation: string | null,
  nominal: string | undefined,
): RateOutcome => {
  const premise = premiseNominal(row, inflation);
  const complete = (rate: BaseRate): GoalRate => ({
    ...rate,
    premise_pct: premise,
    nominal_pct:
      rate.basis === 'nominal'
        ? rate.used_pct
        : inflation === null
          ? null
          : nominalRate(rate.used_pct, inflation),
  });

  if (nominal !== undefined) {
    const typed = normalizeRate(nominal);
    const parsed = parseReturnAssumption(row.return_assumption);
    const common = {
      assumption: row.return_assumption,
      kind: parsed?.kind ?? 'fixed',
      declared_pct: parsed === null ? null : parsed.rate_pct,
      overridden:
        premise === null || Number(typed).toFixed(2) !== Number(premise).toFixed(2),
      inflation_pct: inflation,
    } as const;

    if (!row.amount_in_today_brl) {
      return {
        kind: 'rate',
        rate: complete({ ...common, used_pct: typed, basis: 'nominal' }),
      };
    }
    if (inflation === null) return { kind: 'blocked', block: 'no_inflation', rate: null };

    return {
      kind: 'rate',
      rate: complete({
        ...common,
        used_pct: nonNegativeRate(realRate(typed, inflation)),
        basis: 'real',
      }),
    };
  }

  const base = baseRateOf(row, override, inflation);

  return base.kind === 'blocked' ? base : { kind: 'rate', rate: complete(base.rate) };
};

export const evaluate = (
  row: GoalRow,
  reference: DateOnly,
  override: string | undefined,
  inflation: string | null,
  options: EvaluateOptions = {},
): GoalResult => {
  const standing = goalStanding(row.current_value, row.target_amount);
  const monthsRemaining = Math.max(monthsBetween(reference, row.target_date), 0);
  const pace = paceOf(row, reference);

  const base = {
    id: row.goal_id,
    name: row.name,
    target_amount: row.target_amount,
    target_date: row.target_date,
    amount_in_today_brl: row.amount_in_today_brl,
    return_assumption: row.return_assumption,
    created_on: row.created_on,
    current_value: row.current_value,
    as_of: row.as_of,
    progress_pct: standing.progress_pct,
    remaining_brl: standing.remaining_brl,
    surplus_brl: standing.surplus_brl,
    months_remaining: monthsRemaining,
    pace,
  } as const;

  const withoutProjection = (
    status: GoalStatus,
    blocked: GoalBlock | null,
    rate: GoalRate | null,
  ): GoalResult => ({
    ...base,
    expected_pct: null,
    status,
    blocked,
    rate,
    projection: null,
    chart: null,
    contributions: [],
  });

  const outcome = rateOf(row, override, inflation, options.nominal);
  const rate = outcome.rate;

  // Quem já tem o valor e quem passou do prazo não projetam: não há o que
  // projetar. A taxa continua na resposta, para a tela dizer qual premissa vale.
  if (standing.remaining_brl === '0.00') return withoutProjection('reached', null, rate);
  if (row.target_date <= reference) return withoutProjection('overdue', null, rate);

  if (row.history_start === null)
    return withoutProjection('no_projection', 'no_history', rate);
  if (outcome.kind === 'blocked')
    return withoutProjection('no_projection', outcome.block, null);

  const input: GoalInput = {
    reference_date: reference,
    current_value: row.current_value,
    target_amount: row.target_amount,
    target_date: row.target_date,
    // A meta já está na moeda da taxa: ver `trajectory.ts`.
    amount_in_today_brl: false,
    annual_return_pct: outcome.rate.used_pct,
    monthly_contribution: pace.monthly_contribution,
  };

  const projection = projectGoal(input);

  const ladder = contributionLadder(
    pace.monthly_contribution,
    projection.required_monthly,
  );
  const entries: { amount: string; kind: GoalContributionRow['kind'] }[] = ladder.map(
    (entry) => ({ amount: entry.amount, kind: entry.kind }),
  );
  const simulated = options.monthly === undefined ? null : toMoney(options.monthly);
  if (
    simulated !== null &&
    !entries.some((entry) => toMoney(entry.amount) === simulated)
  ) {
    entries.push({ amount: simulated, kind: 'custom' });
    entries.sort((left, right) => Number(left.amount) - Number(right.amount));
  }
  const table = contributionTable(
    input,
    entries.map((entry) => entry.amount),
  );

  const trajectory = (monthly: string): readonly string[] =>
    goalTrajectory({
      current_value: row.current_value,
      monthly_contribution: monthly,
      annual_return_pct: outcome.rate.used_pct,
      months: projection.months_remaining,
    });

  const expectedPct =
    row.start_date === null || row.start_value === null
      ? null
      : expectedProgress({
          start_date: row.start_date,
          start_value: row.start_value,
          reference_date: reference,
          target_amount: row.target_amount,
          target_date: row.target_date,
          annual_return_pct: outcome.rate.used_pct,
        });

  // OBJ-04: "No ritmo" é o acumulado ter alcançado a marca de hoje da
  // trajetória planejada. Sem marca (objetivo sem ponto de partida), vale a
  // projeção no ritmo atual.
  const onTrack =
    expectedPct === null
      ? projection.on_track
      : Number(base.progress_pct) >= Number(expectedPct);

  return {
    ...base,
    expected_pct: expectedPct,
    status: onTrack ? 'on_track' : 'behind',
    blocked: null,
    rate: outcome.rate,
    projection: {
      projected_amount: projection.projected_amount,
      required_monthly: projection.required_monthly,
      arrival_date: projection.arrival_date as DateOnly | null,
      months_to_arrival: projection.months_to_arrival,
      gap_brl: projection.gap_brl,
      on_track: projection.on_track,
    },
    chart: {
      dates: Array.from(
        { length: projection.months_remaining + 1 },
        (_, month) => addMonths(reference, month) as DateOnly,
      ),
      pace: trajectory(pace.monthly_contribution),
      required: trajectory(projection.required_monthly),
      plan: simulated === null ? null : trajectory(simulated),
    },
    contributions: table.map((option, index) => ({
      monthly_contribution: option.monthly_contribution,
      kind: entries[index]?.kind ?? 'option',
      selected: simulated !== null && option.monthly_contribution === simulated,
      arrival_date: option.arrival_date as DateOnly | null,
      months_to_arrival: option.months_to_arrival,
      reaches_target_date: option.reaches_target_date,
    })),
  };
};

export const getGoals = (deps: GetGoalsDeps) =>
  either(async function* (input: GetGoalsInput) {
    const reference = input.on_date ?? deps.clock.today();

    const snapshot = yield* await deps.goals.snapshot({
      portfolio_id: input.portfolio_id,
      on_date: reference,
    });

    if (snapshot.scope_portfolio === null) {
      return yield* failure(
        new NotFoundError(`Carteira ${input.portfolio_id} não encontrada`),
      );
    }

    const inflation = inflationOf(snapshot.inflation, reference);

    const result: GoalsResult = {
      reference_date: reference,
      scope: {
        portfolio_id: input.portfolio_id,
        name: snapshot.scope_portfolio.name,
      },
      goal:
        snapshot.goal === null
          ? null
          : evaluate(snapshot.goal, reference, input.rate, inflation, {
              nominal: input.nominal_rate,
              monthly: input.monthly,
            }),
    };

    return result;
  });
