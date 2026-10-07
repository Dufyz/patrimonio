import { Decimal } from 'decimal.js';

import { addMonths, calendarDaysBetween } from '../support/dates.js';

/**
 * O retorno de qualquer janela sai de **duas linhas** da série de cota: a do
 * início e a do fim. É o que mantém a tela de Desempenho em duas consultas ao
 * banco em vez de duas mil, e é por isso que o retorno mora na cota e não numa
 * soma de variações diárias.
 *
 * Janela maior do que o histórico devolve nulo, que a tela mostra como traço.
 * Devolver um número anualizado a partir de três meses de histórico seria
 * inventar informação, e é exatamente o tipo de número plausível e errado que o
 * produto existe para não produzir.
 */
export const WINDOWS = [
  'month',
  '3m',
  '6m',
  'ytd',
  '12m',
  '24m',
  'inception',
] as const;

export type WindowKey = (typeof WINDOWS)[number];

const PCT_DP = 2;
const DAYS_PER_YEAR = 365;
/** Abaixo de um ano não se anualiza: extrapolar meses para o ano é invenção. */
const MIN_DAYS_TO_ANNUALIZE = DAYS_PER_YEAR;

export type QuotaPoint = {
  readonly position_date: string;
  readonly quota_value: string;
};

export type WindowReturn = {
  readonly window: WindowKey;
  readonly from: QuotaPoint;
  readonly to: QuotaPoint;
  readonly return_pct: string;
  /** Só quando o período cobre pelo menos um ano. */
  readonly annualized_pct: string | null;
};

const lastDayOfPreviousMonth = (reference: string): string => {
  const year = Number(reference.slice(0, 4));
  const month = Number(reference.slice(5, 7));

  return new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
};

/**
 * A data-base de cada janela. É a data da linha anterior ao período: o retorno do
 * mês é medido contra o último dia do mês passado, não contra o dia 1.
 */
export const windowStart = (reference: string, window: WindowKey): string | null => {
  switch (window) {
    case 'month':
      // O último dia do mês anterior, que é o fechamento de onde o mês parte.
      return lastDayOfPreviousMonth(reference);
    case 'ytd':
      return `${Number(reference.slice(0, 4)) - 1}-12-31`;
    case '3m':
      return addMonths(reference, -3);
    case '6m':
      return addMonths(reference, -6);
    case '12m':
      return addMonths(reference, -12);
    case '24m':
      return addMonths(reference, -24);
    case 'inception':
      return null;
  }
};

/** `((fim / início) − 1) × 100`. Cota não pode ser zero: o banco recusa. */
export const returnPct = (from: string, to: string): string => {
  const base = new Decimal(from);
  if (base.isZero()) return '0.00';

  return new Decimal(to)
    .dividedBy(base)
    .minus(1)
    .times(100)
    .toDecimalPlaces(PCT_DP)
    .toFixed(PCT_DP);
};

/** Composto, a partir do fator do período. Linear daria outro número. */
export const annualizedPct = (from: string, to: string, days: number): string | null => {
  if (days < MIN_DAYS_TO_ANNUALIZE) return null;

  const base = new Decimal(from);
  if (base.isZero()) return null;

  const factor = new Decimal(to).dividedBy(base);

  return factor
    .pow(new Decimal(DAYS_PER_YEAR).dividedBy(days))
    .minus(1)
    .times(100)
    .toDecimalPlaces(PCT_DP)
    .toFixed(PCT_DP);
};

/** O retorno entre duas linhas: é a forma que o repositório usa. */
export const returnBetween = (
  window: WindowKey,
  from: QuotaPoint | null,
  to: QuotaPoint | null,
): WindowReturn | null => {
  if (from === null || to === null) return null;

  const days = calendarDaysBetween(from.position_date, to.position_date);

  return {
    window,
    from,
    to,
    return_pct: returnPct(from.quota_value, to.quota_value),
    annualized_pct: annualizedPct(from.quota_value, to.quota_value, days),
  };
};

/**
 * A linha-base dentro de uma série em memória: a última anterior ou igual à data
 * pedida. Uma série que começa depois da data pedida não tem base, e a janela
 * devolve nulo em vez de um retorno medido de um início que não existe.
 */
export const basePoint = (
  series: readonly QuotaPoint[],
  date: string,
): QuotaPoint | null => {
  let found: QuotaPoint | null = null;

  for (const point of series) {
    if (point.position_date > date) break;
    found = point;
  }

  return found;
};

/**
 * A janela resolvida sobre a série inteira, que é a forma usada em teste e no
 * plano. O caminho de produção lê duas linhas e chama `returnBetween`.
 */
export const resolveWindow = (
  series: readonly QuotaPoint[],
  window: WindowKey,
  reference?: string,
): WindowReturn | null => {
  const last = series[series.length - 1];
  if (last === undefined) return null;

  const to = reference === undefined ? last : basePoint(series, reference);
  if (to === null) return null;

  if (window === 'inception') {
    const first = series[0];
    if (first === undefined || first.position_date === to.position_date) return null;

    return returnBetween(window, first, to);
  }

  const start = windowStart(to.position_date, window);
  if (start === null) return null;

  const first = series[0];
  // Histórico mais curto do que a janela: traço, nunca um número extrapolado.
  if (first === undefined || first.position_date > start) return null;

  return returnBetween(window, basePoint(series, start), to);
};

export const allWindows = (
  series: readonly QuotaPoint[],
  reference?: string,
): Readonly<Record<WindowKey, WindowReturn | null>> =>
  Object.fromEntries(
    WINDOWS.map((window) => [window, resolveWindow(series, window, reference)]),
  ) as Record<WindowKey, WindowReturn | null>;
