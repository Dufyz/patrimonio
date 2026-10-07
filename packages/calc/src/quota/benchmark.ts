import { Decimal } from 'decimal.js';

import { BUSINESS_DAYS_PER_YEAR } from '../fixed_income/curve.js';
import { monthOf } from '../support/dates.js';

/**
 * O benchmark não é série guardada: é definição, calculada a partir de
 * `index_quote` na hora da leitura. Guardar `50% CDI + 50% IBOV` como série
 * exigiria recalcular a tabela inteira a cada mudança de peso, e o usuário muda
 * peso para experimentar.
 *
 * Os índices são guardados como fator diário justamente para isto: o acumulado de
 * qualquer janela é um produto de fatores, e nunca uma reinterpretação da série.
 */
export type BenchmarkPart = {
  readonly index: string;
  /** Peso relativo. `0,5` e `50` dão o mesmo resultado: a soma é normalizada. */
  readonly weight: string;
};

export type BenchmarkDefinition =
  | { readonly kind: 'index'; readonly index: string }
  /** `IPCA + 6%`: o cupom compõe por dia útil sobre o índice, não soma linear. */
  | { readonly kind: 'index_plus_rate'; readonly index: string; readonly rate: string }
  | { readonly kind: 'blend'; readonly parts: readonly BenchmarkPart[] };

export const REBALANCES = ['daily', 'monthly', 'never'] as const;

export type Rebalance = (typeof REBALANCES)[number];

const FACTOR_DP = 12;
const PCT_DP = 2;

const Big = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const one = new Big(1);

/** Fator diário por índice e por data, como `index_quote` entrega. */
export type FactorsByIndex = ReadonlyMap<string, ReadonlyMap<string, string>>;

export type BenchmarkInput = {
  readonly definition: BenchmarkDefinition;
  readonly rebalance?: Rebalance | undefined;
  readonly factors: FactorsByIndex;
  /** As datas do período, em ordem crescente. Dia útil. */
  readonly dates: readonly string[];
};

export type BenchmarkPoint = {
  readonly date: string;
  readonly daily_factor: string;
  readonly accumulated: string;
};

/**
 * Dia sem fator publicado é dia sem variação, não dia interpolado: o buraco da
 * série aparece como buraco, exatamente como no gráfico.
 */
const factorOn = (
  factors: FactorsByIndex,
  index: string,
  date: string,
): Decimal => new Big(factors.get(index)?.get(date) ?? '1');

/** `(1 + i)^(1/252)`: o cupom do benchmark composto por dia útil. */
const dailySpread = (annualPercent: string): Decimal =>
  one
    .plus(new Big(annualPercent).dividedBy(100))
    .pow(one.dividedBy(new Big(BUSINESS_DAYS_PER_YEAR)));

const normalized = (parts: readonly BenchmarkPart[]): readonly { index: string; weight: Decimal }[] => {
  const total = parts.reduce((sum, part) => sum.plus(new Big(part.weight)), new Big(0));

  if (total.isZero()) {
    return parts.map((part) => ({ index: part.index, weight: new Big(0) }));
  }

  return parts.map((part) => ({
    index: part.index,
    weight: new Big(part.weight).dividedBy(total),
  }));
};

/**
 * O acumulado dia a dia. O rebalanceamento é modelado como nocional por parte:
 * `daily` redistribui todo dia, `monthly` na virada do mês e `never` nunca — e
 * nessa última a parte que subiu passa a pesar mais, que é o comportamento de
 * quem comprou e não mexeu.
 */
export const benchmarkSeries = (input: BenchmarkInput): readonly BenchmarkPoint[] => {
  const rebalance = input.rebalance ?? 'never';
  const points: BenchmarkPoint[] = [];

  if (input.definition.kind === 'blend') {
    const parts = normalized(input.definition.parts);
    const notional = parts.map((part) => part.weight);
    let accumulated = one;
    let currentMonth: string | null = null;

    for (const date of input.dates) {
      const month = monthOf(date);

      // A virada do mês redistribui antes de o dia render: o peso declarado vale
      // para o mês inteiro que começa.
      if (rebalance === 'monthly' && currentMonth !== null && month !== currentMonth) {
        parts.forEach((part, index) => {
          notional[index] = part.weight.times(accumulated);
        });
      }
      currentMonth = month;

      const previous = accumulated;

      parts.forEach((part, index) => {
        notional[index] = (notional[index] ?? new Big(0)).times(
          factorOn(input.factors, part.index, date),
        );
      });

      accumulated = notional.reduce((sum, value) => sum.plus(value), new Big(0));

      if (rebalance === 'daily') {
        parts.forEach((part, index) => {
          notional[index] = part.weight.times(accumulated);
        });
      }

      points.push({
        date,
        daily_factor: previous.isZero()
          ? '1.000000000000'
          : accumulated.dividedBy(previous).toDecimalPlaces(FACTOR_DP).toFixed(FACTOR_DP),
        accumulated: accumulated.toDecimalPlaces(FACTOR_DP).toFixed(FACTOR_DP),
      });
    }

    return points;
  }

  const spread =
    input.definition.kind === 'index_plus_rate'
      ? dailySpread(input.definition.rate)
      : one;

  let accumulated = one;

  for (const date of input.dates) {
    const daily = factorOn(input.factors, input.definition.index, date).times(spread);
    accumulated = accumulated.times(daily);

    points.push({
      date,
      daily_factor: daily.toDecimalPlaces(FACTOR_DP).toFixed(FACTOR_DP),
      accumulated: accumulated.toDecimalPlaces(FACTOR_DP).toFixed(FACTOR_DP),
    });
  }

  return points;
};

export type BenchmarkReturn = {
  readonly factor: string;
  readonly return_pct: string;
  readonly days: number;
};

export const benchmarkReturn = (input: BenchmarkInput): BenchmarkReturn => {
  const points = benchmarkSeries(input);
  const last = points[points.length - 1];
  const factor = last === undefined ? one : new Big(last.accumulated);

  return {
    factor: factor.toDecimalPlaces(FACTOR_DP).toFixed(FACTOR_DP),
    return_pct: factor.minus(1).times(100).toDecimalPlaces(PCT_DP).toFixed(PCT_DP),
    days: points.length,
  };
};

/**
 * A diferença contra a carteira sai em pontos percentuais, com sinal. Dividir um
 * percentual pelo outro daria um número sem leitura: "ganhou 1,4 pp do CDI" é
 * frase; "fez 103% do CDI" é outra pergunta, e não é a desta tela.
 */
export const differencePp = (portfolioPct: string, benchmarkPct: string): string =>
  new Decimal(portfolioPct)
    .minus(new Decimal(benchmarkPct))
    .toDecimalPlaces(PCT_DP)
    .toFixed(PCT_DP);
