import { Decimal } from 'decimal.js';

import { MONEY_SCALE, PRICE_SCALE } from '../support/scale.js';

/**
 * A reavaliação de uma posição a preço de pregão. A posição de `position_daily`
 * é a do último fechamento; esta conta troca o preço pelo último negócio e
 * refaz o que depende dele, sem mexer em quantidade nem em custo — o livro não
 * mudou, só o preço.
 *
 * O cálculo mora aqui, e não no caso de uso nem na tela, pelo mesmo motivo de
 * todo o resto: dinheiro só é somado dentro de `calc`.
 */
export type LiveValuationInput = {
  readonly quantity: string;
  readonly cost_basis: string;
  /** O último preço gravado, de onde sai a variação do dia. */
  readonly previous_price: string | null;
  readonly live_price: string;
};

export type LiveValuation = {
  readonly price: string;
  readonly value: string;
  readonly open_result: string;
  /** Nulo com custo zero: dividir por zero é ausência, não infinito. */
  readonly open_result_ratio: string | null;
  /** Nulo sem preço anterior para comparar. */
  readonly day_change_ratio: string | null;
};

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_SCALE).toFixed(MONEY_SCALE);

export const liveValuation = (input: LiveValuationInput): LiveValuation => {
  const price = new Decimal(input.live_price);
  const value = new Decimal(input.quantity).times(price).toDecimalPlaces(MONEY_SCALE);
  const cost = new Decimal(input.cost_basis);
  const result = value.minus(cost);

  const previous =
    input.previous_price === null ? null : new Decimal(input.previous_price);

  return {
    price: price.toDecimalPlaces(PRICE_SCALE).toFixed(PRICE_SCALE),
    value: money(value),
    open_result: money(result),
    open_result_ratio: cost.isZero() ? null : result.dividedBy(cost).toFixed(8),
    day_change_ratio:
      previous === null || previous.isZero()
        ? null
        : price.dividedBy(previous).minus(1).toFixed(8),
  };
};

export type SummaryShape = {
  readonly value: string;
  readonly cost_basis: string;
  readonly open_result: string;
};

export type ShiftedSummary = SummaryShape & {
  readonly open_result_ratio: string | null;
};

/**
 * O subtotal depois da reavaliação: o que já estava, mais a diferença das linhas
 * que mudaram. Partir do subtotal do banco e somar a diferença preserva as
 * linhas que não têm preço de pregão — renda fixa na curva continua valendo o
 * que valia.
 */
export const shiftSummary = (summary: SummaryShape, delta: string): ShiftedSummary => {
  const value = new Decimal(summary.value).plus(delta);
  const result = new Decimal(summary.open_result).plus(delta);
  const cost = new Decimal(summary.cost_basis);

  return {
    value: money(value),
    cost_basis: money(cost),
    open_result: money(result),
    open_result_ratio: cost.isZero() ? null : result.dividedBy(cost).toFixed(8),
  };
};

/** A diferença de valor entre duas posições. */
export const valueDelta = (current: string, previous: string): string =>
  new Decimal(current).minus(previous).toFixed(MONEY_SCALE);

/** Soma de diferenças. */
export const sumDeltas = (deltas: readonly string[]): string =>
  deltas.reduce((sum, delta) => sum.plus(delta), new Decimal(0)).toFixed(MONEY_SCALE);

/** Participação de um valor no total, de 0 a 1. */
export const weightOf = (value: string, total: string): string =>
  new Decimal(total).isZero() ? '0' : new Decimal(value).dividedBy(total).toFixed(8);

/** Variação do conjunto entre dois valores, quando o anterior existe. */
export const changeRatio = (current: string, previous: string): string | null =>
  new Decimal(previous).isZero()
    ? null
    : new Decimal(current).dividedBy(previous).minus(1).toFixed(8);
