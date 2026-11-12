import { Decimal } from 'decimal.js';

import { addMonths, monthOf } from '../support/dates.js';

/**
 * PRJ-01 · O motor de projeção da carteira.
 *
 * Uma conta só, para as duas variações da tela:
 *
 *   saldo(t + 1) = saldo(t) × (1 + r_m) + aporte(t)
 *
 * `r_m` é a taxa mensal **equivalente** à rentabilidade anual esperada, e não a
 * anual dividida por 12 (PA-06): doze meses sem aporte rendem exatamente a taxa
 * declarada. `t = 0` é o valor de hoje, então a projeção no primeiro ponto é a
 * posição da carteira (QUA-01). O aporte do mês `t` é a soma das regras de valor
 * fixo ativas naquele mês, de `from` a `until`, inclusive.
 *
 * Nada de Finanças entra aqui — nem renda, nem saldo de conta: o aporte é o que
 * a regra declara. Nenhuma função chama `new Date()`: `today` é parâmetro.
 */
const Big = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

const MONEY_DP = 2;

/** Os horizontes da tela, em meses: 12 meses, 2, 3 e 5 anos. */
export const PROJECTION_HORIZONS = [12, 24, 36, 60] as const;
export type ProjectionHorizon = (typeof PROJECTION_HORIZONS)[number];

export type ProjectionRule = {
  /** Valor do aporte por mês. */
  readonly amount: string;
  /** `YYYY-MM`: o primeiro mês em que a regra vale. */
  readonly from: string;
  /** `YYYY-MM`: o último mês em que a regra vale. Nulo é sem fim. */
  readonly until: string | null;
};

export type ProjectionInput = {
  /** `YYYY-MM-DD`: o dia de hoje, de onde a projeção parte. */
  readonly today: string;
  readonly current_value: string;
  /** Rentabilidade anual esperada, em %. */
  readonly annual_return_pct: string;
  readonly rules: readonly ProjectionRule[];
  readonly horizon_months: number;
};

export type ProjectionPoint = {
  /** `YYYY-MM` do ponto; `t = 0` é o mês de hoje. */
  readonly month: string;
  readonly value: string;
  readonly contributions_cumulative: string;
  readonly yield_cumulative: string;
};

export type ProjectionKpis = {
  readonly today: string;
  readonly at_horizon: string;
  readonly contributions: string;
  /** Horizonte − hoje − aportes. */
  readonly estimated_yield: string;
};

export type ProjectionResult = {
  readonly series: readonly ProjectionPoint[];
  readonly kpis: ProjectionKpis;
};

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

/** A taxa mensal equivalente à anual, em fração: `(1 + a)^(1/12) − 1`. */
export const projectionMonthlyRate = (annualPct: string): Decimal =>
  new Big(1).plus(new Big(annualPct).div(100)).pow(new Big(1).div(12)).minus(1);

/** O aporte do mês: a soma das regras ativas nele. */
export const contributionOfMonth = (
  rules: readonly ProjectionRule[],
  month: string,
): Decimal =>
  rules.reduce(
    (sum, rule) =>
      month >= rule.from && (rule.until === null || month <= rule.until)
        ? sum.plus(rule.amount)
        : sum,
    new Big(0),
  );

const kpisOf = (series: readonly ProjectionPoint[]): ProjectionKpis => {
  const first = series[0];
  const last = series[series.length - 1];
  const today = new Big(first?.value ?? '0');
  const horizon = new Big(last?.value ?? '0');
  const contributions = new Big(last?.contributions_cumulative ?? '0');

  return {
    today: money(today),
    at_horizon: money(horizon),
    contributions: money(contributions),
    estimated_yield: money(horizon.minus(today).minus(contributions)),
  };
};

export const projectPortfolio = (input: ProjectionInput): ProjectionResult => {
  const rate = projectionMonthlyRate(input.annual_return_pct);
  const start = monthOf(input.today);

  let balance = new Big(input.current_value);
  let contributed = new Big(0);
  const origin = balance;

  const series: ProjectionPoint[] = [];

  for (let t = 0; t <= input.horizon_months; t += 1) {
    const month = monthOf(addMonths(`${start}-01`, t));
    const value = balance;

    series.push({
      month,
      value: money(value),
      contributions_cumulative: money(contributed),
      yield_cumulative: money(value.minus(origin).minus(contributed)),
    });

    const contribution = contributionOfMonth(input.rules, month);
    balance = balance.times(new Big(1).plus(rate)).plus(contribution);
    contributed = contributed.plus(contribution);
  }

  return { series, kpis: kpisOf(series) };
};

/**
 * "Todas": a soma das séries das carteiras, mês a mês. Soma os valores já
 * arredondados, para o total ser exatamente a soma do que a tela mostra por
 * carteira e o rendimento estimado continuar fechando com a identidade.
 */
export const projectTotal = (results: readonly ProjectionResult[]): ProjectionResult => {
  const length = results.reduce((max, r) => Math.max(max, r.series.length), 0);
  const series: ProjectionPoint[] = [];

  for (let index = 0; index < length; index += 1) {
    let value = new Big(0);
    let contributions = new Big(0);
    let yielded = new Big(0);
    let month = '';

    for (const result of results) {
      const point = result.series[index];
      if (point === undefined) continue;
      month = point.month;
      value = value.plus(point.value);
      contributions = contributions.plus(point.contributions_cumulative);
      yielded = yielded.plus(point.yield_cumulative);
    }

    series.push({
      month,
      value: money(value),
      contributions_cumulative: money(contributions),
      yield_cumulative: money(yielded),
    });
  }

  return { series, kpis: kpisOf(series) };
};
