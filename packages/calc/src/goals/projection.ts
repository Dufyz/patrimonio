import { Decimal } from 'decimal.js';

import { addMonths, monthsBetween } from '../support/dates.js';

/**
 * O objetivo responde a uma pergunta só: no ritmo de hoje, eu chego? Para
 * responder sem mentir, três coisas precisam estar separadas e visíveis — o
 * retorno assumido, a inflação que corrige a meta e o aporte que está realmente
 * acontecendo. Esconder qualquer uma delas transforma a projeção em adivinhação
 * com aparência de certeza.
 *
 * ## Sobre a taxa
 *
 * A meta em reais de hoje é corrigida pelo IPCA, e o patrimônio é composto pela
 * taxa declarada. Para que as duas pontas sejam comparáveis, a taxa declarada
 * nesse caso é a **real**: usar uma taxa nominal junto com a correção da meta
 * contaria a inflação duas vezes. A tela declara qual taxa está em uso, e é por
 * isso que ela é parâmetro e não constante.
 *
 * Nenhuma função aqui chama `new Date()`: a data de referência entra por parâmetro.
 */
const MONEY_DP = 2;
const PCT_DP = 2;
const MONTHS_PER_YEAR = 12;

/** Cem anos. Além disso a resposta é "nunca", e não uma data. */
const MAX_MONTHS = 1200;

const Big = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

const zero = new Big(0);
const one = new Big(1);

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

export type GoalInput = {
  /** `YYYY-MM-DD`: de onde a projeção parte. */
  readonly reference_date: string;
  readonly current_value: string;
  readonly target_amount: string;
  readonly target_date: string;
  /** Quando verdadeiro, a meta é corrigida pelo IPCA até a data alvo. */
  readonly amount_in_today_brl: boolean;
  /** Premissa de retorno anual, em %. Real quando a meta é em reais de hoje. */
  readonly annual_return_pct: string;
  /** IPCA anual assumido, em %. Só usado quando a meta é em reais de hoje. */
  readonly annual_inflation_pct?: string | undefined;
  /** O ritmo atual: a média de aporte dos últimos doze meses. */
  readonly monthly_contribution: string;
};

export type GoalProjection = {
  readonly months_remaining: number;
  /** A meta na moeda da data alvo, já corrigida quando é em reais de hoje. */
  readonly target_amount_nominal: string;
  /** Nunca passa de 100: o excedente sai em `surplus_brl`. */
  readonly progress_pct: string;
  readonly surplus_brl: string | null;
  /** Onde o ritmo atual chega na data alvo. */
  readonly projected_amount: string;
  /** O aporte mensal que fecha a meta na data. Zero quando já está feito. */
  readonly required_monthly: string;
  /** Onde o ritmo atual chega. Nulo quando não chega em cem anos. */
  readonly arrival_date: string | null;
  readonly months_to_arrival: number | null;
  readonly on_track: boolean;
  /** Quanto falta na data alvo. Negativo quando sobra. */
  readonly gap_brl: string;
};

/** Taxa mensal equivalente, composta: `(1 + a)^(1/12) − 1`. */
export const monthlyRate = (annualPercent: string): Decimal =>
  one
    .plus(new Big(annualPercent).dividedBy(100))
    .pow(one.dividedBy(new Big(MONTHS_PER_YEAR)))
    .minus(1);

/** `PV(1+r)^n + PMT·((1+r)^n − 1)/r`, com o caso de taxa zero tratado. */
const futureValue = (
  present: Decimal,
  monthly: Decimal,
  rate: Decimal,
  months: number,
): Decimal => {
  if (months <= 0) return present;
  if (rate.isZero()) return present.plus(monthly.times(months));

  const growth = one.plus(rate).pow(months);

  return present.times(growth).plus(monthly.times(growth.minus(1)).dividedBy(rate));
};

/** O aporte que leva `present` até `target` em `months`. Nunca negativo. */
const requiredContribution = (
  present: Decimal,
  target: Decimal,
  rate: Decimal,
  months: number,
): Decimal => {
  if (months <= 0) return Decimal.max(target.minus(present), zero);

  const growth = one.plus(rate).pow(months);
  const missing = target.minus(present.times(growth));

  if (!missing.isPositive()) return zero;
  if (rate.isZero()) return missing.dividedBy(months);

  return missing.times(rate).dividedBy(growth.minus(1));
};

const nominalTarget = (input: GoalInput, months: number): Decimal => {
  const target = new Big(input.target_amount);

  if (!input.amount_in_today_brl) return target;

  const inflation = new Big(input.annual_inflation_pct ?? '0').dividedBy(100);

  return target.times(
    one.plus(inflation).pow(new Big(months).dividedBy(MONTHS_PER_YEAR)),
  );
};

export const projectGoal = (input: GoalInput): GoalProjection => {
  const months = Math.max(monthsBetween(input.reference_date, input.target_date), 0);
  const rate = monthlyRate(input.annual_return_pct);
  const present = new Big(input.current_value);
  const monthly = new Big(input.monthly_contribution);

  const target = nominalTarget(input, months);
  const projected = futureValue(present, monthly, rate, months);

  const arrival = arrivalMonth(input, rate);

  const progress = target.isZero()
    ? zero
    : present.dividedBy(target).times(100);

  const surplus = present.minus(target);

  return {
    months_remaining: months,
    target_amount_nominal: money(target),
    // Progresso nunca passa de 100%: o excedente vira texto, não barra estourada.
    progress_pct: Decimal.min(progress, 100).toDecimalPlaces(PCT_DP).toFixed(PCT_DP),
    surplus_brl: surplus.isPositive() ? money(surplus) : null,
    projected_amount: money(projected),
    required_monthly: money(requiredContribution(present, target, rate, months)),
    arrival_date:
      arrival === null ? null : addMonths(input.reference_date, arrival),
    months_to_arrival: arrival,
    on_track: projected.greaterThanOrEqualTo(target),
    gap_brl: money(target.minus(projected)),
  };
};

/**
 * Em quantos meses o ritmo atual chega. A meta também cresce quando é em reais de
 * hoje, então as duas curvas são comparadas mês a mês — fechar uma fórmula para
 * isso exigiria supor que a inflação é zero, que é justamente o que o usuário não
 * quer supor.
 */
export const arrivalMonth = (input: GoalInput, rate?: Decimal): number | null => {
  const monthlyRateValue = rate ?? monthlyRate(input.annual_return_pct);
  const present = new Big(input.current_value);
  const monthly = new Big(input.monthly_contribution);

  for (let month = 0; month <= MAX_MONTHS; month += 1) {
    const value = futureValue(present, monthly, monthlyRateValue, month);

    if (value.greaterThanOrEqualTo(nominalTarget(input, month))) return month;
  }

  return null;
};

export type ContributionOption = {
  readonly monthly_contribution: string;
  readonly arrival_date: string | null;
  readonly months_to_arrival: number | null;
  /** Verdadeiro quando esse aporte chega até a data alvo. */
  readonly reaches_target_date: boolean;
};

/**
 * A tabela de aporte mensal contra data de chegada: é ela que deixa o usuário
 * escolher entre aportar mais e chegar antes, em vez de receber uma única
 * recomendação que ele não pode negociar.
 */
export const contributionTable = (
  input: GoalInput,
  amounts: readonly string[],
): readonly ContributionOption[] =>
  amounts.map((amount) => {
    const month = arrivalMonth({ ...input, monthly_contribution: amount });

    return {
      monthly_contribution: new Big(amount).toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP),
      arrival_date: month === null ? null : addMonths(input.reference_date, month),
      months_to_arrival: month,
      reaches_target_date:
        month !== null &&
        month <= Math.max(monthsBetween(input.reference_date, input.target_date), 0),
    };
  });

export type MonthlyFlow = {
  /** `YYYY-MM` */
  readonly month: string;
  readonly net_flow: string;
};

/**
 * O ritmo atual é a média de aporte dos últimos doze meses, e não o aporte do mês
 * passado: um mês atípico não deve mudar a projeção de um objetivo de dez anos.
 * Os meses sem aporte entram na média como zero — ignorá-los inflaria o ritmo.
 */
export const averageMonthlyContribution = (
  flows: readonly MonthlyFlow[],
  months = MONTHS_PER_YEAR,
): string => {
  if (months <= 0) return '0.00';

  const recent = [...flows]
    .sort((left, right) => (left.month < right.month ? 1 : -1))
    .slice(0, months);

  const total = recent.reduce((sum, flow) => sum.plus(new Big(flow.net_flow)), zero);

  return money(total.dividedBy(months));
};
