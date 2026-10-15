import { Decimal } from 'decimal.js';

import type { LedgerEntry } from '../average_price/ledger.js';
import { sortEntries } from '../average_price/ledger.js';
import { addMonths } from '../support/dates.js';
import { redemption } from './regressive.js';
import type { FixedIncomeTaxRegime } from './regressive.js';

/**
 * A caixinha é um ativo só cujos aportes são lotes: cada aplicação tem a própria
 * data, e é a data dela que conta para o rendimento e para a alíquota do IR. O
 * resgate consome lotes por uma regra, e é a regra que decide qual data sobra.
 *
 * ## Como o livro representa isso
 *
 * A quantidade é **principal**: uma unidade vale R$ 1,00 aplicado, e o preço
 * unitário da aplicação é 1. O resgate grava o principal consumido como
 * quantidade e o bruto resgatado dividido por ele como preço. Com isso o preço
 * médio e o custo de `applyLedger` continuam corretos sem saber de lote nenhum
 * — o custo restante é o principal restante, qualquer que seja a ordem de
 * consumo. Só o **valor** depende dos lotes, e é este módulo que o calcula.
 *
 * Os lotes não são gravados: saem do livro. Reaplicar a mesma sequência dá os
 * mesmos lotes, o que mantém o livro como única fonte da verdade.
 */
export const REDEMPTION_RULES = ['oldest_first', 'newest_first'] as const;

export type RedemptionRule = (typeof REDEMPTION_RULES)[number];

export type Lot = {
  /** O id da aplicação que abriu o lote. */
  readonly id: string;
  readonly trade_date: string;
  /** Quando o lote fica disponível para resgate: o aporte só liquida depois da data dele. */
  readonly settlement_date: string;
  /**
   * Quando o lote vence: o do aporte, ou o da caixinha quando ela inteira vence.
   * Nulo é lote sem vencimento.
   */
  readonly maturity_date: string | null;
  readonly principal: string;
  /** O principal que ainda não foi resgatado. */
  readonly remaining: string;
};

const QUANTITY_DP = 8;
const MONEY_DP = 2;

const zero = new Decimal(0);

const byRule = (rule: RedemptionRule) => (left: Lot, right: Lot) => {
  const order =
    left.trade_date === right.trade_date
      ? left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0
      : left.trade_date < right.trade_date
        ? -1
        : 1;

  return rule === 'oldest_first' ? order : -order;
};

/** Lote sem vencimento nunca está preso: resgata a qualquer dia. */
const isMatured = (maturity: string | null, date: string): boolean =>
  maturity === null || maturity <= date;

/**
 * Os lotes que o livro deixa, na ordem em que foram abertos. Cada venda consome
 * só lotes já abertos na data dela, pela regra da caixinha.
 */
export const lotsFromLedger = (
  entries: readonly LedgerEntry[],
  rule: RedemptionRule,
  options: {
    readonly until?: string | undefined;
    /** O vencimento da caixinha, herdado pelo lote que não tem o seu. */
    readonly default_maturity?: string | null | undefined;
    /** Prazo padrão do lote, em meses, para o aporte que não traz vencimento próprio. */
    readonly default_term_months?: number | null | undefined;
    /** Liquidez no vencimento: o resgate só alcança lote já vencido. */
    readonly matured_only?: boolean | undefined;
  } = {},
): readonly Lot[] => {
  const lots: {
    id: string;
    trade_date: string;
    settlement_date: string;
    maturity_date: string | null;
    principal: Decimal;
    remaining: Decimal;
  }[] = [];

  for (const [index, entry] of sortEntries(entries).entries()) {
    if (options.until !== undefined && entry.trade_date > options.until) break;

    if (entry.kind === 'buy') {
      const principal = new Decimal(entry.quantity);
      lots.push({
        id: entry.id ?? `rascunho-${index}`,
        trade_date: entry.trade_date,
        settlement_date: entry.settlement_date ?? entry.trade_date,
        maturity_date:
          entry.maturity_date ??
          options.default_maturity ??
          (options.default_term_months === null ||
          options.default_term_months === undefined
            ? null
            : addMonths(entry.trade_date, options.default_term_months)),
        principal,
        remaining: principal,
      });
      continue;
    }

    if (entry.kind !== 'sell') continue;

    let need = new Decimal(entry.quantity);
    const open = lots
      .filter((lot) => lot.remaining.greaterThan(0))
      .filter((lot) => lot.settlement_date <= entry.trade_date)
      .filter(
        (lot) => !options.matured_only || isMatured(lot.maturity_date, entry.trade_date),
      )
      .sort((left, right) =>
        byRule(rule)(
          { ...left, principal: '', remaining: '' },
          { ...right, principal: '', remaining: '' },
        ),
      );

    for (const lot of open) {
      if (need.lessThanOrEqualTo(0)) break;
      const taken = Decimal.min(lot.remaining, need);
      lot.remaining = lot.remaining.minus(taken);
      need = need.minus(taken);
    }
  }

  return lots.map((lot) => ({
    id: lot.id,
    trade_date: lot.trade_date,
    settlement_date: lot.settlement_date,
    maturity_date: lot.maturity_date,
    principal: lot.principal.toFixed(QUANTITY_DP),
    remaining: lot.remaining.toFixed(QUANTITY_DP),
  }));
};

/** O fator da curva de cada lote na data, por id do lote. */
export type FactorsByLot = ReadonlyMap<string, string>;

export type ValuedLot = Lot & {
  /** O lote já venceu na data, ou não tem vencimento. */
  readonly matured: boolean;
  /** O aporte já liquidou: antes disso o lote rende, mas não pode ser resgatado. */
  readonly settled: boolean;
  /** Dá para resgatá-lo na data: liquidou, e venceu ou a caixinha tem liquidez diária. */
  readonly redeemable: boolean;
  readonly gross_value: string;
  readonly accrued_interest: string;
  readonly elapsed_days: number;
  readonly tax_rate: string;
  readonly tax_due: string;
  /** Quanto cairia na conta se o lote inteiro fosse resgatado hoje. */
  readonly net_value: string;
};

export type LotsValuation = {
  readonly lots: readonly ValuedLot[];
  readonly principal: string;
  readonly gross_value: string;
  readonly tax_due: string;
  readonly net_value: string;
};

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

const grossOf = (remaining: string, factor: string): Decimal =>
  new Decimal(remaining).times(new Decimal(factor)).toDecimalPlaces(MONEY_DP);

/** Valor, rendimento e IR estimado de cada lote aberto, e o total. */
export const valueLots = (input: {
  readonly lots: readonly Lot[];
  readonly factors: FactorsByLot;
  readonly reference_date: string;
  readonly tax_regime: FixedIncomeTaxRegime;
  readonly matured_only?: boolean | undefined;
}): LotsValuation => {
  const valued: ValuedLot[] = [];
  let principal = zero;
  let gross = zero;
  let tax = zero;

  for (const lot of input.lots) {
    if (new Decimal(lot.remaining).lessThanOrEqualTo(0)) continue;

    const value = grossOf(lot.remaining, input.factors.get(lot.id) ?? '1');
    const exit = redemption({
      principal: money(new Decimal(lot.remaining)),
      gross_value: value.toFixed(MONEY_DP),
      issued_at: lot.trade_date,
      redemption_date: input.reference_date,
      tax_regime: input.tax_regime,
    });

    principal = principal.plus(lot.remaining);
    gross = gross.plus(value);
    tax = tax.plus(exit.tax_due);

    const matured = isMatured(lot.maturity_date, input.reference_date);
    const settled = lot.settlement_date <= input.reference_date;

    valued.push({
      ...lot,
      matured,
      settled,
      redeemable: settled && (matured || input.matured_only !== true),
      gross_value: value.toFixed(MONEY_DP),
      accrued_interest: value.minus(new Decimal(lot.remaining)).toFixed(MONEY_DP),
      elapsed_days: exit.elapsed_days,
      tax_rate: exit.tax_rate,
      tax_due: exit.tax_due,
      net_value: exit.net_value,
    });
  }

  return {
    lots: valued,
    principal: money(principal),
    gross_value: money(gross),
    tax_due: money(tax),
    net_value: money(gross.minus(tax)),
  };
};

export type RedemptionSlice = {
  readonly lot_id: string;
  readonly trade_date: string;
  readonly principal: string;
  readonly gross_value: string;
  readonly tax_rate: string;
  readonly tax_due: string;
  readonly net_value: string;
  /** O lote foi consumido por inteiro. */
  readonly closes_lot: boolean;
};

export type RedemptionPlan = {
  readonly slices: readonly RedemptionSlice[];
  /** Soma do principal consumido: é a quantidade da venda no livro. */
  readonly principal: string;
  readonly gross_value: string;
  readonly tax_due: string;
  readonly net_value: string;
  /** Preço unitário da venda: bruto por unidade de principal. */
  readonly unit_price: string;
  /** O pedido passa do que a caixinha vale: nada é consumido. */
  readonly insufficient: boolean;
  readonly available_gross: string;
};

/**
 * Quais lotes um resgate de `amount` (bruto) consome. O valor pedido é o que sai
 * da caixinha antes do IR; o líquido é o que cai na conta. Um lote só é parcial
 * quando o pedido termina dentro dele — o consumo é do valor, não do principal,
 * porque é o valor que o usuário digita e o banco debita.
 */
export const planRedemption = (input: {
  readonly lots: readonly Lot[];
  readonly amount: string;
  readonly rule: RedemptionRule;
  readonly redemption_date: string;
  readonly factors: FactorsByLot;
  readonly tax_regime: FixedIncomeTaxRegime;
  /** Liquidez no vencimento: só lote já vencido na data pode ser resgatado. */
  readonly matured_only?: boolean | undefined;
}): RedemptionPlan => {
  const open = input.lots
    .filter(
      (lot) =>
        new Decimal(lot.remaining).greaterThan(0) &&
        lot.settlement_date <= input.redemption_date &&
        (input.matured_only !== true ||
          isMatured(lot.maturity_date, input.redemption_date)),
    )
    .sort(byRule(input.rule));

  const available = open.reduce(
    (total, lot) => total.plus(grossOf(lot.remaining, input.factors.get(lot.id) ?? '1')),
    zero,
  );

  const asked = new Decimal(input.amount).toDecimalPlaces(MONEY_DP);

  if (asked.greaterThan(available) || asked.lessThanOrEqualTo(0)) {
    return {
      slices: [],
      principal: money(zero),
      gross_value: money(zero),
      tax_due: money(zero),
      net_value: money(zero),
      unit_price: '1.00000000',
      insufficient: true,
      available_gross: money(available),
    };
  }

  const slices: RedemptionSlice[] = [];
  let need = asked;
  let principalTotal = zero;
  let taxTotal = zero;

  for (const lot of open) {
    if (need.lessThanOrEqualTo(0)) break;

    const value = grossOf(lot.remaining, input.factors.get(lot.id) ?? '1');
    const whole = need.greaterThanOrEqualTo(value);
    const gross = whole ? value : need;
    const principal = whole
      ? new Decimal(lot.remaining)
      : new Decimal(lot.remaining)
          .times(gross)
          .dividedBy(value)
          .toDecimalPlaces(QUANTITY_DP);

    const exit = redemption({
      principal: money(principal),
      gross_value: gross.toFixed(MONEY_DP),
      issued_at: lot.trade_date,
      redemption_date: input.redemption_date,
      tax_regime: input.tax_regime,
    });

    slices.push({
      lot_id: lot.id,
      trade_date: lot.trade_date,
      principal: principal.toFixed(QUANTITY_DP),
      gross_value: gross.toFixed(MONEY_DP),
      tax_rate: exit.tax_rate,
      tax_due: exit.tax_due,
      net_value: exit.net_value,
      closes_lot: whole,
    });

    principalTotal = principalTotal.plus(principal);
    taxTotal = taxTotal.plus(exit.tax_due);
    need = need.minus(gross);
  }

  return {
    slices,
    principal: principalTotal.toFixed(QUANTITY_DP),
    gross_value: money(asked),
    tax_due: money(taxTotal),
    net_value: money(asked.minus(taxTotal)),
    unit_price: principalTotal.isZero()
      ? '1.00000000'
      : asked.dividedBy(principalTotal).toDecimalPlaces(QUANTITY_DP).toFixed(QUANTITY_DP),
    insufficient: false,
    available_gross: money(available),
  };
};
