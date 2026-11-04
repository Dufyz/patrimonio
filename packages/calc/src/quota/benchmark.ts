import { Decimal } from 'decimal.js';

import { BUSINESS_DAYS_PER_YEAR } from '../fixed_income/curve.js';

/**
 * O benchmark não é série guardada: é uma expressão, calculada a partir de
 * `index_quote` na hora da leitura. `IPCA+6` e `110%CDI` não precisam de tabela
 * nem de recálculo — mudar a taxa é trocar o texto.
 *
 * Os índices são guardados como fator diário justamente para isto: o acumulado de
 * qualquer janela é um produto de fatores, e nunca uma reinterpretação da série.
 */
export type BenchmarkDefinition =
  | { readonly kind: 'index'; readonly index: string }
  /** `IPCA + 6%`: o cupom compõe por dia útil sobre o índice, não soma linear. */
  | { readonly kind: 'index_plus_rate'; readonly index: string; readonly rate: string }
  /** `110% do CDI`: o fator diário do índice, escalado pelo percentual. */
  | { readonly kind: 'percent_of_index'; readonly index: string; readonly percent: string };

const FACTOR_DP = 12;
const PCT_DP = 2;

const Big = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const one = new Big(1);

/** Fator diário por índice e por data, como `index_quote` entrega. */
export type FactorsByIndex = ReadonlyMap<string, ReadonlyMap<string, string>>;

export type BenchmarkInput = {
  readonly definition: BenchmarkDefinition;
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
const factorOn = (factors: FactorsByIndex, index: string, date: string): Decimal =>
  new Big(factors.get(index)?.get(date) ?? '1');

/** `(1 + i)^(1/252)`: o cupom do benchmark composto por dia útil. */
const dailySpread = (annualPercent: string): Decimal =>
  one
    .plus(new Big(annualPercent).dividedBy(100))
    .pow(one.dividedBy(new Big(BUSINESS_DAYS_PER_YEAR)));

/** O fator diário da definição para um dia, a partir do fator do índice. */
const dailyFactor = (
  definition: BenchmarkDefinition,
  index: Decimal,
  spread: Decimal,
): Decimal =>
  definition.kind === 'percent_of_index'
    ? one.plus(index.minus(1).times(new Big(definition.percent)).dividedBy(100))
    : index.times(spread);

/** O acumulado dia a dia, partindo de 1. */
export const benchmarkSeries = (input: BenchmarkInput): readonly BenchmarkPoint[] => {
  const points: BenchmarkPoint[] = [];

  const spread =
    input.definition.kind === 'index_plus_rate'
      ? dailySpread(input.definition.rate)
      : one;

  let accumulated = one;

  for (const date of input.dates) {
    const daily = dailyFactor(
      input.definition,
      factorOn(input.factors, input.definition.index, date),
      spread,
    );
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
