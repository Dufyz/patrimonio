import { Decimal } from 'decimal.js';

/**
 * A conversão do que a fonte publica no **fator diário** que `index_quote`
 * guarda. Fica aqui, e não no provedor, por duas razões: o provedor não faz
 * aritmética — ele busca e devolve, dizendo apenas qual é a unidade da série —
 * e esta conta é exatamente o tipo de coisa que precisa de fixture conferida à
 * mão, sem rede.
 *
 * Guardar fator, e não percentual acumulado, é o que torna o retorno de
 * qualquer janela um produto de fatores, sem reinterpretar a série a cada
 * consulta.
 *
 * ## As três unidades
 *
 * - `daily_pct` — a taxa do dia em percentual, como as séries 12 (CDI) e 11
 *   (Selic) do Banco Central publicam. O fator é `1 + v/100`, e o acumulado é o
 *   produto: é assim que a calculadora do próprio Banco Central acumula, e é
 *   por isso que o nosso acumulado de doze meses bate com o dela.
 * - `monthly_pct` — a variação do mês, como a série 433 (IPCA). Um número por
 *   mês não serve para marcar um título dia a dia, então ele é distribuído
 *   pró-rata **dia útil**: cada dia útil do mês recebe a raiz `du` do fator do
 *   mês.
 * - `index_points` — a pontuação de fechamento, como IBOV e IFIX. O fator do dia
 *   é a razão entre dois fechamentos consecutivos, e o primeiro dia da série não
 *   tem fator porque não tem anterior.
 */
export const INDEX_UNITS = ['daily_pct', 'monthly_pct', 'index_points'] as const;

export type IndexUnit = (typeof INDEX_UNITS)[number];

/** A mesma escala de `index_quote.daily_factor`. */
const FACTOR_DP = 12;

/** Alta no intermediário: o produto de 2.500 fatores não pode derivar. */
const Big = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const one = new Big(1);

const factor = (value: Decimal): string =>
  value.toDecimalPlaces(FACTOR_DP).toFixed(FACTOR_DP);

export type IndexObservation = {
  /** `YYYY-MM-DD`. Em `monthly_pct`, qualquer dia do mês de referência. */
  readonly reference_date: string;
  readonly unit: IndexUnit;
  /** O número como a fonte publicou. */
  readonly raw_value: string;
};

export type DailyFactor = {
  readonly quote_date: string;
  readonly daily_factor: string;
  readonly raw_value: string;
};

/** `1 + v/100`. A taxa do dia já é diária: não há conversão de prazo. */
export const factorFromDailyPct = (rawValue: string): string =>
  factor(one.plus(new Big(rawValue).dividedBy(100)));

const monthOf = (date: string): string => date.slice(0, 7);

/**
 * O fator do dia útil num mês de IPCA: a raiz `du` do fator do mês. Mês sem dia
 * útil nenhum não existe no calendário da B3, mas a guarda fica — dividir por
 * zero aqui gravaria `NaN` na coluna.
 */
export const factorFromMonthlyPct = (
  rawValue: string,
  businessDaysInMonth: number,
): string => {
  if (businessDaysInMonth <= 0) return factor(one);

  const monthly = one.plus(new Big(rawValue).dividedBy(100));

  return factor(monthly.pow(one.dividedBy(businessDaysInMonth)));
};

/**
 * Distribui cada observação pelos dias úteis a que ela pertence.
 *
 * Dia útil sem publicação **não gera linha**: a série fica com buraco explícito
 * em vez de valor repetido. Repetir o último fator inventaria rendimento, e
 * inventar rendimento num feriado bancário é o tipo de erro que só aparece
 * quando o extrato do banco não fecha.
 */
export const dailyFactorsFrom = (
  observations: readonly IndexObservation[],
  businessDays: readonly string[],
): readonly DailyFactor[] => {
  const calendar = new Set(businessDays);

  const perMonth = new Map<string, number>();
  for (const day of businessDays) {
    const month = monthOf(day);
    perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
  }

  const rows: DailyFactor[] = [];
  const seen = new Set<string>();

  for (const observation of observations) {
    if (observation.unit === 'daily_pct') {
      // Observação em dia não útil é descartada: preço e índice só existem em
      // dia de pregão, e a série não carrega o que o calendário não tem.
      if (!calendar.has(observation.reference_date)) continue;
      if (seen.has(observation.reference_date)) continue;

      seen.add(observation.reference_date);
      rows.push({
        quote_date: observation.reference_date,
        daily_factor: factorFromDailyPct(observation.raw_value),
        raw_value: observation.raw_value,
      });
      continue;
    }

    if (observation.unit === 'monthly_pct') {
      const month = monthOf(observation.reference_date);
      const days = businessDays.filter((day) => monthOf(day) === month);
      const daily = factorFromMonthlyPct(observation.raw_value, days.length);

      for (const day of days) {
        if (seen.has(day)) continue;
        seen.add(day);
        rows.push({
          quote_date: day,
          daily_factor: daily,
          raw_value: observation.raw_value,
        });
      }
      continue;
    }

    // `index_points` é tratado em par, abaixo: um ponto isolado não tem fator.
  }

  if (observations.some((observation) => observation.unit === 'index_points')) {
    const points = observations
      .filter((observation) => observation.unit === 'index_points')
      .filter((observation) => calendar.has(observation.reference_date))
      .sort((left, right) =>
        left.reference_date < right.reference_date
          ? -1
          : left.reference_date > right.reference_date
            ? 1
            : 0,
      );

    for (const [index, observation] of points.entries()) {
      const previous = points[index - 1];
      if (previous === undefined) continue;

      const before = new Big(previous.raw_value);
      if (before.isZero()) continue;

      rows.push({
        quote_date: observation.reference_date,
        daily_factor: factor(new Big(observation.raw_value).dividedBy(before)),
        raw_value: observation.raw_value,
      });
    }
  }

  return rows.sort((left, right) =>
    left.quote_date < right.quote_date ? -1 : left.quote_date > right.quote_date ? 1 : 0,
  );
};

/**
 * O acumulado de um intervalo: o produto dos fatores. É o que a calculadora do
 * Banco Central devolve, e o que o benchmark da tela mostra.
 */
export const accumulate = (factors: readonly string[]): string => {
  let total = new Big(1);
  for (const value of factors) total = total.times(new Big(value));

  return total.toDecimalPlaces(FACTOR_DP).toFixed(FACTOR_DP);
};
