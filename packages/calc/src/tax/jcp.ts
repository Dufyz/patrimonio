import { Decimal } from 'decimal.js';

/**
 * JCP tem imposto retido na fonte: o que entra na conta é o líquido, e é ele
 * que o extrato mostra. A alíquota é parâmetro porque é lei, e lei muda — a de
 * hoje é 15%, e o dia em que ela mudar não pode exigir recompilar o motor.
 */
export const withheldFromGross = (gross: string, percent: string): string =>
  new Decimal(gross)
    .times(new Decimal(percent))
    .dividedBy(100)
    .toDecimalPlaces(2)
    .toFixed(2);

/** O valor por ação vezes a quantidade na data-com, com duas casas. */
export const payoutGross = (quantity: string, amountPerShare: string): string =>
  new Decimal(quantity).times(new Decimal(amountPerShare)).toDecimalPlaces(2).toFixed(2);

/**
 * O valor por ação quando o provento vem como total: dividir em `Decimal`, e
 * não em `number` — `numeric(20,8)` não cabe em `double`, e um centavo perdido
 * aqui vira divergência contra o extrato.
 */
export const perShareFromGross = (gross: string, quantity: string): string => {
  const shares = new Decimal(quantity);
  if (shares.isZero()) return '0';

  return new Decimal(gross).dividedBy(shares).toDecimalPlaces(8).toFixed(8);
};
