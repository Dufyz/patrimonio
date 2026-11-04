import { Decimal } from 'decimal.js';

/**
 * RN-65 · O dinheiro de Finanças é `Decimal` dentro do motor e string decimal
 * fora dele. Nenhum valor passa por `number`: a soma de uma lista exibida é
 * sempre igual ao total exibido, sem diferença de um centavo.
 */

export const ZERO = new Decimal(0);

export const dec = (value: string | Decimal): Decimal => new Decimal(value);

/** Duas casas, a escala do `NUMERIC(18,2)`. */
export const money = (value: Decimal): string => value.toDecimalPlaces(2).toFixed(2);

export const total = (values: readonly Decimal[]): Decimal =>
  values.reduce((acc, value) => acc.plus(value), ZERO);

export const sumStrings = (values: readonly string[]): Decimal =>
  values.reduce((acc, value) => acc.plus(value), ZERO);

export const min = (a: Decimal, b: Decimal): Decimal => (a.lte(b) ? a : b);
export const max = (a: Decimal, b: Decimal): Decimal => (a.gte(b) ? a : b);

/**
 * RN-45 · Divide em `parts` partes iguais, com o resto de centavos na primeira.
 * `100.00` em 3 → `[33.34, 33.33, 33.33]`; a soma é sempre o total.
 */
export const splitInstallments = (amount: Decimal, parts: number): readonly Decimal[] => {
  if (!Number.isInteger(parts) || parts < 1) return [amount];
  const base = amount.div(parts).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const remainder = amount.minus(base.times(parts));
  return Array.from({ length: parts }, (_, index) =>
    index === 0 ? base.plus(remainder) : base,
  );
};

/**
 * RN-64 · Percentuais em décimos de ponto que somam exatamente 1000: o resto vai
 * para as maiores frações (maior resto). Lista vazia ou soma zero devolve zeros.
 */
export const allocatePercentTenths = (values: readonly Decimal[]): readonly number[] => {
  const sum = total(values);
  if (sum.lte(0)) return values.map(() => 0);

  const raw = values.map((value) => value.times(1000).div(sum));
  const floors = raw.map((value) => value.floor().toNumber());
  let left = 1000 - floors.reduce((acc, value) => acc + value, 0);

  const order = raw
    .map((value, index) => ({ index, fraction: value.minus(value.floor()) }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index);

  const result = [...floors];
  for (const { index } of order) {
    if (left <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    left -= 1;
  }
  return result;
};

/** `1234.5` ou `1.234,50` → `"1234.50"`; texto que não é dinheiro devolve `null`. */
export const parseMoneyText = (text: string): string | null => {
  const trimmed = text.trim().replace(/^R\$\s*/, '');
  if (trimmed === '') return null;
  const normalized = /,/.test(trimmed)
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return money(new Decimal(normalized));
};
