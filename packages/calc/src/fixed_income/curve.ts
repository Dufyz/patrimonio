import { Decimal } from 'decimal.js';

/**
 * Marcação na curva: quanto vale um CDB, uma LCI ou um título prefixado em
 * qualquer data. Esses papéis não têm preço de mercado — o valor é o principal
 * corrigido pelo indexador contratado, dia útil por dia útil.
 *
 * ## A convenção, declarada
 *
 * A estratégia de testes exige que divergência de convenção contra a planilha
 * seja decidida e documentada, não tolerada. A convenção adotada é a da B3:
 *
 * - O período de remuneração vai da data de aplicação **inclusive** até a data
 *   de referência **exclusive**. No dia da aplicação `du` é zero e o valor é o
 *   principal.
 * - `du` conta **dia útil**, lido do calendário que entra por parâmetro. Nunca
 *   dia corrido, e nunca derivado de regra: feriado bancário não é derivável.
 * - Pós-fixado: `TDI_k` é o fator diário do índice menos um, truncado em 8
 *   casas; cada termo `1 + TDI_k × p` é truncado em 16 casas; o fator acumulado
 *   é truncado em 8.
 * - Prefixado e spread: `(1 + i)^(du/252)`, truncado em 9 casas.
 *
 * Truncar, e não arredondar, é a convenção do mercado. Arredondar daria uma
 * diferença de centavos contra o extrato do banco, que é exatamente a classe de
 * divergência que a tolerância zero existe para encontrar.
 */
export const INDEXERS = ['cdi_pct', 'ipca_plus', 'prefixed', 'selic_plus'] as const;

export type CurveIndexer = (typeof INDEXERS)[number];

/** Dias úteis no ano, pela convenção brasileira. */
export const BUSINESS_DAYS_PER_YEAR = 252;

const TDI_DP = 8;
const TERM_DP = 16;
const INDEX_FACTOR_DP = 8;
const RATE_FACTOR_DP = 9;
const FACTOR_DP = 12;
const MONEY_DP = 2;

/** Precisão alta no acumulado: o produto de 2.500 fatores não pode derivar. */
const Big = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const truncate = (value: Decimal, places: number): Decimal =>
  value.toDecimalPlaces(places, Decimal.ROUND_DOWN);

export type IndexFactor = {
  /** `YYYY-MM-DD` */
  readonly date: string;
  /** Fator diário como `index_quote` guarda: 1,000394 para um dia de CDI. */
  readonly daily_factor: string;
};

export type CurveInput = {
  readonly principal: string;
  /** Data de aplicação. Entra no período; nela o valor é o principal. */
  readonly issued_at: string;
  readonly reference_date: string;
  readonly indexer: CurveIndexer;
  /** Percentual do índice em `cdi_pct`; taxa anual nos demais. */
  readonly rate: string;
  /** Dias úteis do calendário, em ordem crescente. Só eles rendem. */
  readonly business_days: readonly string[];
  /** A série do indexador. Ausente em prefixado. */
  readonly index_factors?: readonly IndexFactor[] | undefined;
  /**
   * O IPCA do mês corrente só é publicado no mês seguinte. Até sair, o dia útil
   * sem índice usa este fator, e a linha fica marcada como projetada — quando o
   * índice sai, o recálculo troca a projeção pelo número real.
   */
  readonly projected_daily_factor?: string | undefined;
};

export type CurveValue = {
  readonly reference_date: string;
  readonly business_days: number;
  readonly index_factor: string;
  readonly rate_factor: string;
  readonly factor: string;
  readonly gross_value: string;
  readonly accrued_interest: string;
  /** Dias úteis que usaram projeção em vez de índice publicado. */
  readonly projected_days: readonly string[];
  /** Dias úteis sem índice e sem projeção: não rendem, e o fato é reportado. */
  readonly missing_days: readonly string[];
};

/** O indexador contratado usa uma série; o prefixado não usa nenhuma. */
const usesIndex = (indexer: CurveIndexer): boolean => indexer !== 'prefixed';

/** Em `cdi_pct` o percentual entra dentro do fator do índice, dia por dia. */
const appliesPercentToIndex = (indexer: CurveIndexer): boolean => indexer === 'cdi_pct';

/**
 * O fator do dia para um pós-fixado. `1 + TDI × p` é a fórmula da B3 para
 * percentual do CDI: aplicar o percentual sobre a taxa anual e só depois
 * converter para diária daria outro número, e é o erro mais comum aqui.
 */
const dailyTerm = (
  dailyFactor: Decimal,
  percent: Decimal,
  applyPercent: boolean,
): Decimal => {
  if (!applyPercent) return dailyFactor;

  const tdi = truncate(dailyFactor.minus(1), TDI_DP);

  return truncate(new Big(1).plus(tdi.times(percent).dividedBy(100)), TERM_DP);
};

/** `(1 + i)^(du/252)`, composto por dia útil — nunca linear. */
export const annualToPeriodFactor = (
  annualPercent: string,
  businessDays: number,
): string => {
  if (businessDays === 0) return new Big(1).toFixed(RATE_FACTOR_DP);

  const annual = new Big(1).plus(new Big(annualPercent).dividedBy(100));
  const exponent = new Big(businessDays).dividedBy(BUSINESS_DAYS_PER_YEAR);

  return truncate(annual.pow(exponent), RATE_FACTOR_DP).toFixed(RATE_FACTOR_DP);
};

/**
 * Os dias úteis remunerados: da aplicação inclusive à referência exclusive. Uma
 * referência anterior à aplicação devolve lista vazia, e não um período negativo.
 */
export const accrualDays = (
  businessDays: readonly string[],
  issuedAt: string,
  referenceDate: string,
): readonly string[] =>
  businessDays.filter((day) => day >= issuedAt && day < referenceDate);

type Accumulated = {
  readonly factor: Decimal;
  readonly projected: string[];
  readonly missing: string[];
};

const accumulateIndex = (
  days: readonly string[],
  factors: ReadonlyMap<string, string>,
  percent: Decimal,
  applyPercent: boolean,
  projected: string | undefined,
): Accumulated => {
  let factor = new Big(1);
  const projectedDays: string[] = [];
  const missingDays: string[] = [];

  for (const day of days) {
    const published = factors.get(day);

    if (published === undefined) {
      if (projected === undefined) {
        // Buraco na série é buraco: o dia não rende, e o fato aparece na
        // resposta. Repetir o último fator inventaria rendimento.
        missingDays.push(day);
        continue;
      }

      projectedDays.push(day);
      factor = factor.times(dailyTerm(new Big(projected), percent, applyPercent));
      continue;
    }

    factor = factor.times(dailyTerm(new Big(published), percent, applyPercent));
  }

  return { factor, projected: projectedDays, missing: missingDays };
};

const indexMap = (
  factors: readonly IndexFactor[] | undefined,
): ReadonlyMap<string, string> =>
  new Map((factors ?? []).map((entry) => [entry.date, entry.daily_factor]));

/** O valor na curva em uma data. */
export const curveValue = (input: CurveInput): CurveValue => {
  const days = accrualDays(input.business_days, input.issued_at, input.reference_date);
  const percent = new Big(input.rate);
  const applyPercent = appliesPercentToIndex(input.indexer);

  const index = usesIndex(input.indexer)
    ? accumulateIndex(
        days,
        indexMap(input.index_factors),
        percent,
        applyPercent,
        input.projected_daily_factor,
      )
    : { factor: new Big(1), projected: [], missing: [] };

  const indexFactor = truncate(index.factor, INDEX_FACTOR_DP);

  // Em `cdi_pct` o percentual já está dentro do fator do índice; nos demais o
  // spread contratado compõe por fora, também por dia útil.
  const rateFactor = applyPercent
    ? new Big(1).toFixed(RATE_FACTOR_DP)
    : annualToPeriodFactor(input.rate, days.length);

  const factor = indexFactor.times(new Big(rateFactor));
  const principal = new Big(input.principal);
  const gross = principal.times(factor).toDecimalPlaces(MONEY_DP);

  return {
    reference_date: input.reference_date,
    business_days: days.length,
    index_factor: indexFactor.toFixed(INDEX_FACTOR_DP),
    rate_factor: rateFactor,
    factor: factor.toDecimalPlaces(FACTOR_DP).toFixed(FACTOR_DP),
    gross_value: gross.toFixed(MONEY_DP),
    accrued_interest: gross.minus(principal).toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP),
    projected_days: index.projected,
    missing_days: index.missing,
  };
};

/**
 * O valor na curva em cada dia útil de um intervalo, acumulando numa passada só.
 * O fechamento diário precisa de uma linha por dia, e refazer o produto do zero
 * a cada dia transformaria dez anos de reconstrução em minutos de CPU.
 *
 * O resultado de cada data é idêntico ao de `curveValue` naquela data, e um
 * teste compara as duas formas: a otimização não tem licença para mudar número.
 */
export const curveSeries = (
  input: Omit<CurveInput, 'reference_date'> & {
    readonly from_date: string;
    readonly through_date: string;
  },
): readonly CurveValue[] => {
  const percent = new Big(input.rate);
  const applyPercent = appliesPercentToIndex(input.indexer);
  const withIndex = usesIndex(input.indexer);
  const factors = indexMap(input.index_factors);
  const principal = new Big(input.principal);

  let index = new Big(1);
  let elapsed = 0;
  const projected: string[] = [];
  const missing: string[] = [];
  const series: CurveValue[] = [];

  for (const day of input.business_days) {
    if (day > input.through_date) break;

    // O dia de referência rende a partir do dia seguinte: o acumulado usado na
    // data é o dos dias úteis anteriores a ela, e o da aplicação é 1.
    if (day >= input.from_date && day >= input.issued_at) {
      const indexFactor = truncate(index, INDEX_FACTOR_DP);
      const rateFactor = applyPercent
        ? new Big(1).toFixed(RATE_FACTOR_DP)
        : annualToPeriodFactor(input.rate, elapsed);
      const factor = indexFactor.times(new Big(rateFactor));
      const gross = principal.times(factor).toDecimalPlaces(MONEY_DP);

      series.push({
        reference_date: day,
        business_days: elapsed,
        index_factor: indexFactor.toFixed(INDEX_FACTOR_DP),
        rate_factor: rateFactor,
        factor: factor.toDecimalPlaces(FACTOR_DP).toFixed(FACTOR_DP),
        gross_value: gross.toFixed(MONEY_DP),
        accrued_interest: gross
          .minus(principal)
          .toDecimalPlaces(MONEY_DP)
          .toFixed(MONEY_DP),
        projected_days: [...projected],
        missing_days: [...missing],
      });
    }

    if (day < input.issued_at) continue;

    elapsed += 1;

    if (!withIndex) continue;

    const published = factors.get(day);

    if (published === undefined) {
      if (input.projected_daily_factor === undefined) {
        missing.push(day);
        continue;
      }

      projected.push(day);
      index = index.times(
        dailyTerm(new Big(input.projected_daily_factor), percent, applyPercent),
      );
      continue;
    }

    index = index.times(dailyTerm(new Big(published), percent, applyPercent));
  }

  return series;
};
