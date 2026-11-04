import { Decimal } from 'decimal.js';

/**
 * A soma dos objetivos de várias carteiras: o que a faixa-resumo da tela de
 * Objetivos em "Todas as carteiras" mostra.
 *
 * Só entram objetivos na **mesma moeda** (reais de hoje): somar uma meta em
 * reais de hoje com outra em reais da data alvo daria um número que não
 * significa nada. Quem chama decide quem entra; aqui só se soma.
 */
const MONEY_DP = 2;
const PCT_DP = 2;

const Big = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

const zero = new Big(0);
const hundred = new Big(100);

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

const pct = (part: Decimal, whole: Decimal): string | null =>
  whole.isZero()
    ? null
    : part.dividedBy(whole).times(hundred).toDecimalPlaces(PCT_DP).toFixed(PCT_DP);

export type SummaryItem = {
  readonly id: string;
  readonly current_value: string;
  readonly target_amount: string;
  readonly target_date: string;
  /** Onde o objetivo deveria estar hoje, em %. Nulo sem tempo medido. */
  readonly expected_pct: string | null;
  /** O aporte que fecha a meta na data. */
  readonly required_monthly: string;
  /** A média de aporte dos meses medidos. */
  readonly current_monthly: string;
};

export type SummaryShare = {
  /** A fatia do aporte necessário total. Nulo quando ninguém precisa aportar. */
  readonly required_share_pct: string | null;
  /** A fatia do que se aporta hoje. Nulo quando ninguém aporta. */
  readonly current_share_pct: string | null;
};

export type RequiredStep = {
  /** `YYYY-MM-DD`: até esta data o aporte necessário total é `monthly`. */
  readonly until: string;
  readonly monthly: string;
};

export type GoalsSummary = {
  readonly target_amount: string;
  readonly current_value: string;
  readonly remaining_brl: string;
  /** Nunca passa de 100. */
  readonly progress_pct: string;
  /** A média do esperado de cada objetivo, ponderada pela meta. Nulo se faltar algum. */
  readonly expected_pct: string | null;
  readonly required_monthly: string;
  readonly current_monthly: string;
  /** Quanto falta aportar por mês; negativo quando o aporte de hoje já passa do necessário. */
  readonly gap_monthly: string;
  readonly last_target_date: string | null;
  /**
   * O aporte necessário total muda quando uma meta fecha: cada degrau vale até
   * o prazo de uma meta e o seguinte é o que sobra sem ela.
   */
  readonly required_schedule: readonly RequiredStep[];
  readonly shares: Readonly<Record<string, SummaryShare>>;
};

export const summarizeGoals = (items: readonly SummaryItem[]): GoalsSummary => {
  const sum = (pick: (item: SummaryItem) => string): Decimal =>
    items.reduce((total, item) => total.plus(new Big(pick(item))), zero);

  const target = sum((item) => item.target_amount);
  const current = sum((item) => item.current_value);
  const required = sum((item) => item.required_monthly);
  const paced = sum((item) => item.current_monthly);

  const remaining = Decimal.max(target.minus(current), zero);
  const progress = target.isZero()
    ? zero
    : Decimal.min(current.dividedBy(target).times(hundred), hundred);

  const expected = items.every((item) => item.expected_pct !== null)
    ? target.isZero()
      ? null
      : items
          .reduce(
            (total, item) =>
              total.plus(
                new Big(item.expected_pct ?? '0').times(new Big(item.target_amount)),
              ),
            zero,
          )
          .dividedBy(target)
          .toDecimalPlaces(PCT_DP)
          .toFixed(PCT_DP)
    : null;

  const dates = [
    ...new Set(
      items
        .filter((item) => new Big(item.required_monthly).isPositive())
        .map((item) => item.target_date),
    ),
  ].sort();

  return {
    target_amount: money(target),
    current_value: money(current),
    remaining_brl: money(remaining),
    progress_pct: progress.toDecimalPlaces(PCT_DP).toFixed(PCT_DP),
    expected_pct: items.length === 0 ? null : expected,
    required_monthly: money(required),
    current_monthly: money(paced),
    gap_monthly: money(required.minus(paced)),
    last_target_date:
      items.length === 0
        ? null
        : (items
            .map((item) => item.target_date)
            .sort()
            .at(-1) ?? null),
    required_schedule: dates.map((until) => ({
      until,
      monthly: money(
        items
          .filter((item) => item.target_date >= until)
          .reduce((total, item) => total.plus(new Big(item.required_monthly)), zero),
      ),
    })),
    shares: Object.fromEntries(
      items.map((item) => [
        item.id,
        {
          required_share_pct: pct(new Big(item.required_monthly), required),
          current_share_pct: pct(new Big(item.current_monthly), paced),
        },
      ]),
    ),
  };
};
