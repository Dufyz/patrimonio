import { Decimal } from 'decimal.js';

import { benchmarkSeries } from '../quota/benchmark.js';
import type {
  BenchmarkDefinition,
  FactorsByIndex,
  Rebalance,
} from '../quota/benchmark.js';
import { returnPct } from '../quota/windows.js';
import type { QuotaPoint } from '../quota/windows.js';

/**
 * A tela de Desempenho compara a carteira com benchmarks em muitos recortes — a
 * janela, o mês, o ano, o gráfico —, e todos têm a mesma forma: **uma base e um
 * fim**. A base é o fechamento de onde o período parte e fica de fora; o fim
 * entra. É a mesma convenção da cota (`returnBetween`), e é o que faz a carteira
 * e o benchmark medirem exatamente os mesmos dias.
 *
 * Dois relógios existem aqui e não se confundem: o da carteira, que são os dias
 * em que ela fechou, e o do benchmark, que são os dias em que algum índice foi
 * publicado. O calendário que mede o benchmark é a **união** dos dois. Medir só
 * pelos dias da carteira perderia o fator de um dia útil em que o fechamento
 * atrasou, e a carteira ficaria comparada com um índice que andou menos do que
 * andou.
 */
export type BenchmarkSpec = {
  readonly definition: BenchmarkDefinition;
  readonly rebalance?: Rebalance | undefined;
  readonly factors: FactorsByIndex;
  /** A união dos dias da carteira e dos dias de índice, em ordem crescente. */
  readonly calendar: readonly string[];
};

const PCT_DP = 2;

/** `acumulado − 1`, em percentual. O acumulado nasce em 1 no dia da base. */
const accumulatedPct = (accumulated: string): string =>
  new Decimal(accumulated)
    .minus(1)
    .times(100)
    .toDecimalPlaces(PCT_DP)
    .toFixed(PCT_DP);

/** Os dias do calendário depois da base e até o fim, inclusive. */
export const datesBetween = (
  calendar: readonly string[],
  base: string,
  end: string,
): readonly string[] => calendar.filter((date) => date > base && date <= end);

/**
 * O calendário de medição: os dias de fechamento mais todo dia em que algum
 * índice tem fator, sem repetir e em ordem.
 */
export const measurementCalendar = (
  factors: FactorsByIndex,
  seriesDates: Iterable<string>,
): readonly string[] => {
  const dates = new Set<string>(seriesDates);

  for (const byDate of factors.values()) {
    for (const date of byDate.keys()) dates.add(date);
  }

  return [...dates].sort();
};

/**
 * O retorno do benchmark entre a base e o fim. Período sem nenhum dia — base
 * igual ao fim, ou um fim de semana inteiro — devolve `0.00`, que é o que o
 * índice rendeu: nada.
 */
export const benchmarkPeriodReturn = (
  spec: BenchmarkSpec,
  base: string,
  end: string,
): string => {
  const points = benchmarkSeries({
    definition: spec.definition,
    rebalance: spec.rebalance,
    factors: spec.factors,
    dates: datesBetween(spec.calendar, base, end),
  });

  const last = points[points.length - 1];

  return last === undefined ? '0.00' : accumulatedPct(last.accumulated);
};

/**
 * O benchmark acumulado em cada data pedida, partindo de zero na base. É a
 * linha tracejada do gráfico: ela é desenhada sobre as datas da carteira, e a
 * data sem fechamento da carteira não some do índice — o fator dela entra no
 * primeiro ponto desenhado depois.
 *
 * Uma data anterior ao primeiro fator devolve `0.00`, não `null`: a linha
 * começa na base, e é dali que ela parte.
 */
export const benchmarkCumulative = (
  spec: BenchmarkSpec,
  base: string,
  sampleDates: readonly string[],
): readonly string[] => {
  const last = sampleDates[sampleDates.length - 1];
  if (last === undefined) return [];

  const points = benchmarkSeries({
    definition: spec.definition,
    rebalance: spec.rebalance,
    factors: spec.factors,
    dates: datesBetween(spec.calendar, base, last),
  });

  let cursor = 0;
  let current = '0.00';

  return sampleDates.map((date) => {
    while (cursor < points.length && (points[cursor]?.date ?? '') <= date) {
      current = accumulatedPct(points[cursor]?.accumulated ?? '1');
      cursor += 1;
    }

    return current;
  });
};

/**
 * A carteira acumulada em cada ponto, medida contra a base. É o retorno da cota,
 * e por isso o aporte no meio do período não aparece nele.
 */
export const cumulativeReturns = (
  points: readonly QuotaPoint[],
  base: QuotaPoint,
): readonly string[] =>
  points.map((point) => returnPct(base.quota_value, point.quota_value));

/**
 * Retorno de cada ano civil, da cota. A base do ano é o último fechamento do
 * ano anterior; no primeiro ano da história é o primeiro fechamento da série,
 * porque é de lá que a carteira começou a ter cota.
 *
 * Os dois extremos voltam junto do número porque o benchmark precisa medir o
 * **mesmo** intervalo: comparar o ano inteiro de um índice com os nove meses em
 * que a carteira existiu seria comparar períodos diferentes.
 */
export type YearReturn = {
  readonly year: number;
  readonly base_date: string;
  readonly end_date: string;
  readonly return_pct: string;
};

export const yearReturns = (points: readonly QuotaPoint[]): readonly YearReturn[] => {
  const first = points[0];
  if (first === undefined) return [];

  // O último fechamento de cada ano, na ordem em que os anos aparecem.
  const lastOfYear = new Map<number, QuotaPoint>();

  for (const point of points) {
    lastOfYear.set(Number(point.position_date.slice(0, 4)), point);
  }

  const result: YearReturn[] = [];
  let previous: QuotaPoint | null = null;

  for (const [year, end] of lastOfYear) {
    const base: QuotaPoint = previous ?? first;

    result.push({
      year,
      base_date: base.position_date,
      end_date: end.position_date,
      return_pct: returnPct(base.quota_value, end.quota_value),
    });

    previous = end;
  }

  return result;
};
