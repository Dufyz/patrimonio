/**
 * D-06 · A grade de um mês, para o calendário de período personalizado.
 *
 * Em UTC e sobre string, pela mesma razão de `period.ts`: a grade precisa
 * começar no dia 1 do mês pedido, e não no dia 30 do anterior porque o fuso de
 * São Paulo é negativo.
 */

/** Domingo primeiro, como o calendário da prancha 16. */
export const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

export const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;
