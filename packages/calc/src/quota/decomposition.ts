import { Decimal } from 'decimal.js';

import { returnPct } from './windows.js';
import type { QuotaDay } from './series.js';

/**
 * A decomposição é a resposta visual da pergunta que motivou o produto: quanto do
 * crescimento veio de aporte e quanto veio de rentabilidade. Sem ela, um ano em
 * que se aportou muito e o mercado caiu parece um ano bom.
 *
 * A identidade que precisa fechar em todo mês:
 *
 *     saldo inicial + aporte líquido + rendimento = saldo final
 *
 * Ela fecha por construção, porque o rendimento diário já é a variação menos o
 * fluxo: somar os dias do mês soma a identidade. O mês com prejuízo devolve
 * rendimento negativo, sem truncar em zero — truncar esconderia exatamente o mês
 * que o usuário quer entender.
 */
const MONEY_DP = 2;

const zero = new Decimal(0);

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

export type MonthlyDecomposition = {
  /** `YYYY-MM` */
  readonly month: string;
  readonly year: number;
  readonly month_number: number;
  readonly opening_value: string;
  readonly net_flow: string;
  readonly income: string;
  /** A parcela do rendimento que veio de provento, destacada. */
  readonly payouts: string;
  /** O resto do rendimento: variação de preço e marcação na curva. */
  readonly price_change: string;
  readonly closing_value: string;
  /** Retorno do mês pela cota, imune ao fluxo. Nulo no primeiro mês parcial. */
  readonly return_pct: string | null;
};

/**
 * O que a decomposição lê de cada dia. `QuotaDay` satisfaz este tipo, e o que
 * vem do banco — que não precisa carregar `quota_count` só para somar o mês —
 * também.
 */
export type DecompositionDay = Pick<
  QuotaDay,
  'position_date' | 'total_value' | 'net_flow' | 'income' | 'payouts' | 'quota_value'
>;

export type DecompositionOptions = {
  /** O fechamento do mês anterior ao início da série, num recálculo parcial. */
  readonly previous?:
    { readonly total_value: string; readonly quota_value: string } | undefined;
};

export const decomposeByMonth = (
  series: readonly DecompositionDay[],
  options: DecompositionOptions = {},
): readonly MonthlyDecomposition[] => {
  const months: MonthlyDecomposition[] = [];

  let openingValue =
    options.previous === undefined ? zero : new Decimal(options.previous.total_value);
  let baseQuota = options.previous?.quota_value ?? null;

  let current: string | null = null;
  let netFlow = zero;
  let income = zero;
  let payouts = zero;
  let closing = openingValue;
  let closingQuota: string | null = baseQuota;

  const flush = (): void => {
    if (current === null) return;

    months.push({
      month: current,
      year: Number(current.slice(0, 4)),
      month_number: Number(current.slice(5, 7)),
      opening_value: money(openingValue),
      net_flow: money(netFlow),
      income: money(income),
      payouts: money(payouts),
      price_change: money(income.minus(payouts)),
      closing_value: money(closing),
      return_pct:
        baseQuota === null || closingQuota === null
          ? null
          : returnPct(baseQuota, closingQuota),
    });

    openingValue = closing;
    baseQuota = closingQuota;
    netFlow = zero;
    income = zero;
    payouts = zero;
  };

  for (const day of series) {
    const month = day.position_date.slice(0, 7);

    if (month !== current) {
      flush();
      current = month;
      // O primeiro mês da história não tem cota anterior: o retorno dele é medido
      // da primeira cota da série, que é o valor inicial.
      if (baseQuota === null) baseQuota = day.quota_value;
    }

    netFlow = netFlow.plus(new Decimal(day.net_flow));
    income = income.plus(new Decimal(day.income));
    payouts = payouts.plus(new Decimal(day.payouts));
    closing = new Decimal(day.total_value);
    closingQuota = day.quota_value;
  }

  flush();

  return months;
};

/** O total do ano, que é a última coluna da grade mês por ano. */
export const yearTotals = (
  months: readonly MonthlyDecomposition[],
): readonly {
  readonly year: number;
  readonly net_flow: string;
  readonly income: string;
  readonly payouts: string;
}[] => {
  const totals = new Map<number, { flow: Decimal; income: Decimal; payouts: Decimal }>();

  for (const month of months) {
    const bucket = totals.get(month.year) ?? {
      flow: zero,
      income: zero,
      payouts: zero,
    };

    totals.set(month.year, {
      flow: bucket.flow.plus(new Decimal(month.net_flow)),
      income: bucket.income.plus(new Decimal(month.income)),
      payouts: bucket.payouts.plus(new Decimal(month.payouts)),
    });
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, bucket]) => ({
      year,
      net_flow: money(bucket.flow),
      income: money(bucket.income),
      payouts: money(bucket.payouts),
    }));
};
