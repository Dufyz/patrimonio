import type { Cents } from '../lib/money.js';

/**
 * Dinheiro entre o front e a API: a API fala em texto decimal (`"1234.50"`), as
 * telas em centavos inteiros. A conversão é só de texto, sem passar por `float`.
 */
export const decimalToCents = (value: string): Cents => {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
};

export const centsToDecimal = (cents: Cents): string => {
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
};
