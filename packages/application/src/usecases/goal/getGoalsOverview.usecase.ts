import {
  addMonths,
  contributionLadder,
  deflateAmount,
  monthOf,
  monthsBetween,
  normalizeRate,
  parseReturnAssumption,
  planGoals,
  realRate,
  summarizeGoals,
  toMoney,
} from '@patrimonio/calc';
import type { PlanAllocation, PlanGoal, PlanResult } from '@patrimonio/calc';
import type { DateOnly } from '@patrimonio/domain';
import { either } from '@patrimonio/shared';

import type { Clock } from '../../interfaces/clock.js';
import type { GoalRepository } from '../../interfaces/goal.repository.js';
import type { GoalRow } from '../../interfaces/goal.repository.js';
import type { GoalBlock, GoalResult, GoalStatus } from './getGoals.usecase.js';
import {
  evaluate,
  inflationOf,
  nonNegativeRate,
  premiseNominal,
} from './getGoals.usecase.js';

/**
 * T-07 · Os objetivos de **todas** as carteiras: quanto aportar por mês, no
 * total e em cada carteira, para bater todas as metas, e quando isso acontece.
 *
 * Cada carteira tem o seu objetivo, avaliado pela mesma `evaluate` da tela
 * individual: a projeção de uma carteira aqui e lá é a mesma conta. O que este
 * caso de uso acrescenta é decidir **quem se soma** e **como o aporte se
 * divide**, e são três decisões:
 *
 * ## Só se soma o que está na mesma moeda
 *
 * Meta em reais de hoje, com projeção (ou já cumprida), entra nas somas e no
 * plano. Meta em reais da data alvo é **trazida a reais de hoje** pelo IPCA dos
 * últimos doze meses, suposto constante até o prazo — a tela declara a
 * suposição e a meta original continua visível —, e então entra como as outras.
 * Sem IPCA para fazer a conversão, objetivo vencido e objetivo sem projeção
 * ficam na tabela com o motivo e fora dos totais: somar reais de hoje com reais
 * de 2040 daria um número que não quer dizer nada, e um objetivo sem projeção
 * não tem aporte necessário para somar.
 *
 * ## O plano distribui aporte futuro
 *
 * O dinheiro já investido numa carteira não migra para outra. O orçamento é o
 * que a pessoa consegue aportar por mês no total, e o plano o divide entre as
 * carteiras a partir de agora — proporcional ao aporte necessário de cada uma,
 * ou por prioridade — e, com a cascata, reaproveita a parcela de uma meta que
 * já fechou. Sem orçamento pedido, vale o aporte necessário total, que fecha
 * cada meta no próprio prazo.
 *
 * ## Duas datas, e nenhuma é a do plano
 *
 * "No ritmo atual" é o que acontece se nada mudar: cada carteira com o próprio
 * aporte médio, sem redistribuir nada — o dinheiro de uma meta fechada não vai
 * para outra. A data do plano é a do orçamento pedido, e só o plano realoca
 * (`cascade`). São contas diferentes e a resposta as mantém separadas.
 */
export type GetGoalsOverviewDeps = {
  readonly goals: GoalRepository;
  readonly clock: Clock;
};

export type GoalsDistribution = 'proportional' | 'priority';

export type GetGoalsOverviewInput = {
  readonly on_date?: DateOnly | undefined;
  /** O aporte mensal total a distribuir. Sem ele, vale o necessário. */
  readonly budget?: string | undefined;
  readonly distribution?: GoalsDistribution | undefined;
  /** Reaproveitar o aporte de metas fechadas. Padrão: sim. */
  readonly cascade?: boolean | undefined;
  /** A ordem de prioridade, por id de carteira. */
  readonly priority?: readonly string[] | undefined;
  /**
   * A rentabilidade simulada por carteira (id → taxa nominal ao ano, em %), no
   * lugar da premissa guardada, como a "rentabilidade esperada" da Projeção. O
   * IPCA só entra por baixo, para converter à moeda da meta. Nunca é gravada.
   */
  readonly rates?: Readonly<Record<string, string>> | undefined;
};

export type GoalsExclusion = 'nominal' | 'overdue' | 'no_projection';

export type GoalsPlanShare = {
  readonly monthly: string;
  readonly share_pct: string | null;
  readonly arrival_date: DateOnly | null;
  readonly months_to_arrival: number | null;
  readonly reaches_target_date: boolean;
};

export type GoalsOverviewGoal = {
  readonly id: string;
  readonly name: string;
  /** Em reais de hoje: a meta nominal já convertida, quando é o caso. */
  readonly target_amount: string;
  /** A meta como o usuário a escreveu, quando foi convertida a reais de hoje. */
  readonly nominal_target_amount: string | null;
  readonly target_date: DateOnly;
  readonly amount_in_today_brl: boolean;
  readonly return_assumption: string | null;
  readonly current_value: string;
  readonly as_of: DateOnly | null;
  readonly progress_pct: string;
  readonly remaining_brl: string;
  readonly expected_pct: string | null;
  readonly status: GoalStatus;
  readonly blocked: GoalBlock | null;
  readonly months_remaining: number;
  readonly counted: boolean;
  readonly excluded_reason: GoalsExclusion | null;
  readonly required_monthly: string | null;
  readonly required_share_pct: string | null;
  readonly current_monthly: string;
  readonly current_share_pct: string | null;
  readonly current_arrival_date: DateOnly | null;
  readonly current_months_to_arrival: number | null;
  readonly plan: GoalsPlanShare | null;
  readonly rate: {
    /** A premissa do objetivo como taxa nominal ao ano. Nulo sem IPCA para convertê-la. */
    readonly premise_pct: string | null;
    /** A taxa nominal que entrou na conta. */
    readonly used_pct: string | null;
    readonly overridden: boolean;
  } | null;
};

export type GoalsOverviewRow = {
  readonly portfolio_id: string;
  readonly portfolio_name: string;
  readonly goal: GoalsOverviewGoal | null;
};

export type GoalsScenario = {
  readonly monthly: string;
  readonly kind: 'current' | 'required' | 'option' | 'custom';
  readonly arrival_date: DateOnly | null;
  readonly months_vs_deadline: number | null;
  readonly selected: boolean;
};

export type GoalsOverviewResult = {
  readonly reference_date: DateOnly;
  readonly portfolios: readonly GoalsOverviewRow[];
  readonly totals: {
    readonly goals: number;
    readonly counted: number;
    readonly target_amount: string;
    readonly current_value: string;
    readonly remaining_brl: string;
    readonly progress_pct: string;
    readonly expected_pct: string | null;
    readonly last_target_date: DateOnly | null;
    readonly required_monthly: string;
    readonly current_monthly: string;
    readonly gap_monthly: string;
    readonly required_schedule: readonly {
      readonly until: DateOnly;
      readonly monthly: string;
    }[];
    readonly pace_arrival_date: DateOnly | null;
    readonly pace_months_vs_deadline: number | null;
    /** O IPCA 12M que converteu as metas nominais. Nulo sem IPCA. */
    readonly inflation_pct: string | null;
  };
  readonly plan: {
    readonly budget: string;
    readonly distribution: GoalsDistribution;
    readonly cascade: boolean;
    readonly arrival_date: DateOnly | null;
    readonly months_vs_deadline: number | null;
  };
  readonly scenarios: readonly GoalsScenario[];
  readonly chart: {
    readonly dates: readonly DateOnly[];
    readonly pace: readonly string[];
    readonly required: readonly string[];
    readonly plan: readonly string[];
    readonly target_amount: string;
  } | null;
};

/** O gráfico para em quarenta anos: depois disso a linha não diz mais nada. */
const CHART_MAX_MONTHS = 480;

const COUNTED_STATUSES: readonly GoalStatus[] = ['on_track', 'behind', 'reached'];

const monthIndex = (date: string): number =>
  Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

const exclusionOf = (result: GoalResult): GoalsExclusion | null => {
  if (result.status === 'overdue') return 'overdue';
  if (!COUNTED_STATUSES.includes(result.status)) return 'no_projection';
  if (!result.amount_in_today_brl) return 'nominal';

  return null;
};

type Adjusted = {
  readonly goal: GoalRow;
  /** A meta nominal original, quando ela foi trazida a reais de hoje. */
  readonly nominal_target: string | null;
};

/**
 * Meta em reais da data alvo vira meta em reais de hoje: o valor-alvo é
 * deflacionado pelo IPCA 12M e a taxa passa a ser a real. `IPCA+x` já é real;
 * uma taxa fixa (`9`) vira `(1 + 9%) / (1 + IPCA) − 1`. Sem IPCA, sem premissa
 * entendida ou com o prazo vencido, a meta fica como está e a avaliação
 * individual diz por quê.
 */
const inTodaysReais = (
  row: GoalRow,
  reference: DateOnly,
  inflation: string | null,
): Adjusted => {
  const untouched: Adjusted = { goal: row, nominal_target: null };
  if (row.amount_in_today_brl || inflation === null) return untouched;
  if (row.target_date <= reference) return untouched;

  const parsed = parseReturnAssumption(row.return_assumption);
  if (parsed === null) return untouched;

  return {
    nominal_target: row.target_amount,
    goal: {
      ...row,
      amount_in_today_brl: true,
      target_amount: deflateAmount(
        row.target_amount,
        monthsBetween(reference, row.target_date),
        inflation,
      ),
      return_assumption:
        parsed.kind === 'ipca_plus'
          ? row.return_assumption
          : nonNegativeRate(realRate(parsed.rate_pct, inflation)),
    },
  };
};

/**
 * A taxa simulada é nominal ao ano. Meta em reais de hoje usa taxa real, então
 * a nominal é deflacionada pelo IPCA; meta em reais da data alvo guarda a
 * nominal como está, e `inTodaysReais` a converte depois.
 */
const simulated = (
  row: GoalRow,
  typed: string | undefined,
  inflation: string | null,
): GoalRow => {
  if (typed === undefined) return row;

  const nominal = normalizeRate(typed);
  if (!row.amount_in_today_brl || inflation === null) {
    return { ...row, return_assumption: nominal };
  }

  return { ...row, return_assumption: nonNegativeRate(realRate(nominal, inflation)) };
};

/** A premissa e a taxa em uso, as duas nominais ao ano, para o campo da tela. */
const rateOf = (
  row: GoalRow,
  typed: string | undefined,
  inflation: string | null,
): GoalsOverviewGoal['rate'] => {
  const parsed = parseReturnAssumption(row.return_assumption);
  if (parsed === null && typed === undefined) return null;

  const premise = premiseNominal(row, inflation);
  const used = typed === undefined ? premise : normalizeRate(typed);

  return {
    premise_pct: premise,
    used_pct: used,
    overridden:
      typed !== undefined &&
      (premise === null || Number(used).toFixed(2) !== Number(premise).toFixed(2)),
  };
};

/** Quem não aporta (ou retira) conta como zero: a coluna é "quanto aporto". */
const nonNegative = (value: string): string => (value.startsWith('-') ? '0.00' : value);

export const getGoalsOverview = (deps: GetGoalsOverviewDeps) =>
  either(async function* (input: GetGoalsOverviewInput) {
    const reference = input.on_date ?? deps.clock.today();
    const distribution = input.distribution ?? 'proportional';
    const cascade = input.cascade ?? true;
    const priority = input.priority ?? [];
    const rates = input.rates ?? {};

    const snapshot = yield* await deps.goals.overview({ on_date: reference });
    const inflation = inflationOf(snapshot.inflation, reference);

    const evaluated = snapshot.portfolios.map((portfolio) => {
      const adjusted =
        portfolio.goal === null
          ? null
          : inTodaysReais(
              simulated(portfolio.goal, rates[portfolio.portfolio_id], inflation),
              reference,
              inflation,
            );

      return {
        portfolio,
        original: portfolio.goal,
        nominal_target: adjusted?.nominal_target ?? null,
        result:
          adjusted === null
            ? null
            : evaluate(adjusted.goal, reference, undefined, inflation),
        // A mesma conta da tela da carteira, na moeda do objetivo: é dela que
        // saem as datas do ritmo atual, para as duas telas dizerem o mesmo.
        native:
          portfolio.goal === null
            ? null
            : evaluate(portfolio.goal, reference, undefined, inflation, {
                nominal: rates[portfolio.portfolio_id],
              }),
      };
    });

    const counted = evaluated.flatMap((entry) =>
      entry.result !== null && exclusionOf(entry.result) === null
        ? [{ id: entry.portfolio.portfolio_id, result: entry.result }]
        : [],
    );

    const summary = summarizeGoals(
      counted.map(({ id, result }) => ({
        id,
        current_value: result.current_value,
        target_amount: result.target_amount,
        target_date: result.target_date,
        expected_pct:
          result.expected_pct ?? (result.status === 'reached' ? '100.00' : null),
        required_monthly: result.projection?.required_monthly ?? '0.00',
        current_monthly: nonNegative(result.pace.monthly_contribution),
      })),
    );

    const planGoalsList: readonly PlanGoal[] = counted.map(({ id, result }) => ({
      id,
      current_value: result.current_value,
      target_amount: result.target_amount,
      annual_return_pct: result.rate?.used_pct ?? '0',
      required_monthly: result.projection?.required_monthly ?? '0.00',
    }));

    const lastTarget = summary.last_target_date as DateOnly | null;
    const deadlineMonths =
      lastTarget === null
        ? 0
        : Math.max(monthIndex(lastTarget) - monthIndex(reference), 0);

    const vsDeadline = (months: number | null): number | null =>
      months === null || lastTarget === null
        ? null
        : monthIndex(addMonths(reference, months)) - monthIndex(lastTarget);

    const arrivalOf = (months: number | null): DateOnly | null =>
      months === null ? null : (addMonths(reference, months) as DateOnly);

    const run = (allocation: PlanAllocation): PlanResult =>
      planGoals(planGoalsList, allocation, CHART_MAX_MONTHS);

    const paceAllocation: PlanAllocation = {
      kind: 'fixed',
      monthly: Object.fromEntries(
        counted.map(({ id, result }) => [
          id,
          nonNegative(result.pace.monthly_contribution),
        ]),
      ),
    };
    const requiredAllocation: PlanAllocation = {
      kind: 'fixed',
      monthly: Object.fromEntries(
        counted.map(({ id, result }) => [
          id,
          result.projection?.required_monthly ?? '0.00',
        ]),
      ),
    };

    const budget = toMoney(input.budget ?? summary.required_monthly);
    const budgetAllocation = (amount: string): PlanAllocation => ({
      kind: 'budget',
      budget: amount,
      distribution,
      cascade,
      priority,
    });

    const hasCounted = counted.length > 0;
    const pace = run(paceAllocation);

    // O ritmo atual não realoca nada, então cada meta é independente: a data de
    // todas é a da última a fechar entre as datas de cada carteira.
    const monthsOf = (result: GoalResult): number | null =>
      result.status === 'reached' ? 0 : (result.projection?.months_to_arrival ?? null);
    const paceMonths = new Map(
      evaluated.flatMap((entry) =>
        entry.native !== null &&
        entry.result !== null &&
        exclusionOf(entry.result) === null
          ? [[entry.portfolio.portfolio_id, monthsOf(entry.native)] as const]
          : [],
      ),
    );
    const paceMonthsAll = [...paceMonths.values()].some((months) => months === null)
      ? null
      : Math.max(0, ...[...paceMonths.values()].map((months) => months ?? 0));
    const required = run(requiredAllocation);
    const chosen = run(budgetAllocation(budget));

    const ladder = contributionLadder(summary.current_monthly, summary.required_monthly);
    const scenarios: GoalsScenario[] = ladder.map((entry) => {
      const amount = toMoney(entry.amount);
      const months =
        entry.kind === 'current'
          ? paceMonthsAll
          : amount === budget
            ? chosen.months_to_all
            : run(budgetAllocation(amount)).months_to_all;

      return {
        monthly: amount,
        kind: entry.kind,
        arrival_date: arrivalOf(months),
        months_vs_deadline: vsDeadline(months),
        selected: amount === budget,
      };
    });

    if (input.budget !== undefined && !scenarios.some((scenario) => scenario.selected)) {
      scenarios.push({
        monthly: budget,
        kind: 'custom',
        arrival_date: arrivalOf(chosen.months_to_all),
        months_vs_deadline: vsDeadline(chosen.months_to_all),
        selected: true,
      });
      scenarios.sort((left, right) => Number(left.monthly) - Number(right.monthly));
    }

    const horizon = Math.min(
      CHART_MAX_MONTHS,
      Math.max(
        deadlineMonths,
        paceMonthsAll ?? 0,
        chosen.months_to_all ?? 0,
        required.months_to_all ?? 0,
      ),
    );

    const dates = Array.from(
      { length: horizon + 1 },
      (_, month) => addMonths(reference, month) as DateOnly,
    );

    const planByGoal = new Map(chosen.goals.map((goal) => [goal.id, goal]));

    const portfolios: GoalsOverviewRow[] = evaluated.map(
      ({ portfolio, original, nominal_target, result }) => {
        const base = {
          portfolio_id: portfolio.portfolio_id,
          portfolio_name: portfolio.portfolio_name,
        };

        if (result === null) return { ...base, goal: null };

        const exclusion = exclusionOf(result);
        const share = summary.shares[portfolio.portfolio_id];
        const planned = planByGoal.get(portfolio.portfolio_id);
        const paced = paceMonths.get(portfolio.portfolio_id) ?? null;

        const goal: GoalsOverviewGoal = {
          id: result.id,
          name: result.name,
          target_amount: result.target_amount,
          nominal_target_amount: nominal_target,
          target_date: result.target_date,
          amount_in_today_brl:
            original?.amount_in_today_brl ?? result.amount_in_today_brl,
          return_assumption: original?.return_assumption ?? result.return_assumption,
          current_value: result.current_value,
          as_of: result.as_of,
          progress_pct: result.progress_pct,
          remaining_brl: result.remaining_brl,
          expected_pct: result.expected_pct,
          status: result.status,
          blocked: result.blocked,
          months_remaining: result.months_remaining,
          counted: exclusion === null,
          excluded_reason: exclusion,
          required_monthly:
            exclusion === null ? (result.projection?.required_monthly ?? '0.00') : null,
          required_share_pct: share?.required_share_pct ?? null,
          current_monthly: nonNegative(result.pace.monthly_contribution),
          current_share_pct: share?.current_share_pct ?? null,
          current_arrival_date: arrivalOf(paced),
          current_months_to_arrival: paced,
          rate:
            original === null
              ? null
              : rateOf(original, rates[portfolio.portfolio_id], inflation),
          plan:
            planned === undefined
              ? null
              : {
                  monthly: planned.monthly,
                  share_pct:
                    Number(budget) > 0
                      ? ((Number(planned.monthly) / Number(budget)) * 100).toFixed(2)
                      : null,
                  arrival_date: arrivalOf(planned.months_to_arrival),
                  months_to_arrival: planned.months_to_arrival,
                  reaches_target_date:
                    planned.months_to_arrival !== null &&
                    monthOf(addMonths(reference, planned.months_to_arrival)) <=
                      monthOf(result.target_date),
                },
        };

        return { ...base, goal };
      },
    );

    const result: GoalsOverviewResult = {
      reference_date: reference,
      portfolios,
      totals: {
        goals: evaluated.filter((entry) => entry.result !== null).length,
        counted: counted.length,
        target_amount: summary.target_amount,
        current_value: summary.current_value,
        remaining_brl: summary.remaining_brl,
        progress_pct: summary.progress_pct,
        expected_pct: summary.expected_pct,
        last_target_date: lastTarget,
        required_monthly: summary.required_monthly,
        current_monthly: summary.current_monthly,
        gap_monthly: summary.gap_monthly,
        required_schedule: summary.required_schedule.map((step) => ({
          until: step.until as DateOnly,
          monthly: step.monthly,
        })),
        pace_arrival_date: arrivalOf(paceMonthsAll),
        pace_months_vs_deadline: vsDeadline(paceMonthsAll),
        inflation_pct: inflation,
      },
      plan: {
        budget,
        distribution,
        cascade,
        arrival_date: arrivalOf(chosen.months_to_all),
        months_vs_deadline: vsDeadline(chosen.months_to_all),
      },
      scenarios: hasCounted ? scenarios : [],
      chart: hasCounted
        ? {
            dates,
            pace: pace.series.slice(0, horizon + 1),
            required: required.series.slice(0, horizon + 1),
            plan: chosen.series.slice(0, horizon + 1),
            target_amount: summary.target_amount,
          }
        : null,
    };

    return result;
  });
