import { Decimal } from 'decimal.js';

/**
 * As escalas do schema, num lugar só. Elas existem aqui e não em `application`
 * porque a regra é dura: o cálculo acontece em `decimal.js` **dentro de `calc`**.
 * Um plano que importasse `decimal.js` por conta própria passaria a somar dinheiro
 * fora do motor, e é exatamente assim que duas telas começam a mostrar números
 * diferentes para a mesma pergunta.
 *
 * Nenhum valor monetário passa por `number` do JavaScript no caminho: `numeric(20,8)`
 * não cabe em `double`.
 */
export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 8;
export const PRICE_SCALE = 8;

const at = (value: string, scale: number): string =>
  new Decimal(value === '' ? 0 : value).toDecimalPlaces(scale).toFixed(scale);

/** Reais, com as duas casas que batem com o extrato. */
export const toMoney = (value: string): string => at(value, MONEY_SCALE);

/** Quantidade, com as oito casas que o Tesouro exige. */
export const toQuantity = (value: string): string => at(value, QUANTITY_SCALE);

/** Preço unitário, com as oito casas do PU de um título. */
export const toPrice = (value: string): string => at(value, PRICE_SCALE);

/** Produto em reais: quantidade por cotação, custo por fator de curva. */
export const multiplyMoney = (left: string, right: string): string =>
  new Decimal(left)
    .times(new Decimal(right))
    .toDecimalPlaces(MONEY_SCALE)
    .toFixed(MONEY_SCALE);

export const isZeroAmount = (value: string): boolean => new Decimal(value).isZero();

export const isNegativeAmount = (value: string): boolean =>
  new Decimal(value).isNegative();
