import type { DateOnly } from '@patrimonio/domain';

import { daysInMonth } from './period.js';

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

export type MonthGrid = {
  readonly year: number;
  readonly month: number;
  readonly label: string;
  /** Seis semanas de sete posições. `null` é dia de outro mês. */
  readonly weeks: readonly (readonly (DateOnly | null)[])[];
};

export const monthGrid = (year: number, month: number): MonthGrid => {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const total = daysInMonth(year, month);

  const cells: (DateOnly | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= total; day += 1) {
    cells.push(
      `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
        day,
      ).padStart(2, '0')}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (DateOnly | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return {
    year,
    month,
    label: `${MONTH_NAMES[month - 1] ?? ''} ${year}`,
    weeks,
  };
};

/** O mês anterior ao dado, para o calendário mostrar dois lado a lado. */
export const previousMonth = (
  year: number,
  month: number,
): { readonly year: number; readonly month: number } =>
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

export const monthOf = (
  date: DateOnly,
): { readonly year: number; readonly month: number } => {
  const [year = '0', month = '1'] = date.split('-');
  return { year: Number(year), month: Number(month) };
};

export type RangeSelection = {
  readonly from: DateOnly | null;
  readonly to: DateOnly | null;
};

/**
 * O próximo estado ao clicar em um dia. Clicar antes do começo recomeça a
 * seleção em vez de inverter o intervalo: quem clica em uma data anterior
 * quase sempre está escolhendo de novo, não pedindo um período de trás para
 * frente.
 */
export const selectDay = (current: RangeSelection, day: DateOnly): RangeSelection => {
  if (current.from === null || current.to !== null) return { from: day, to: null };
  if (day < current.from) return { from: day, to: null };
  return { from: current.from, to: day };
};

export const isWithin = (
  day: DateOnly,
  selection: RangeSelection,
  hovered: DateOnly | null,
): boolean => {
  const { from } = selection;
  if (from === null) return false;
  const end = selection.to ?? hovered;
  if (end === null) return day === from;
  return day >= from && day <= end;
};
