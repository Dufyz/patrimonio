/**
 * Datas de negócio de Finanças: `YYYY-MM-DD` do início ao fim, sempre texto.
 * Nenhuma função aqui lê o relógio nem cria `Date` no fuso local — um `Date` de
 * `2026-10-01` lido em outro fuso vira 30/09, o deslocamento de um dia que faz
 * uma compra cair na fatura errada.
 */

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

export const parseIso = (date: string): { year: number; month: number; day: number } => {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
};

export const toIso = (year: number, month: number, day: number): string =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const toUtc = (date: string): number => {
  const { year, month, day } = parseIso(date);
  return Date.UTC(year, month - 1, day);
};

const fromUtc = (ms: number): string => {
  const value = new Date(ms);
  return toIso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
};

const DAY_MS = 86_400_000;

export const addDays = (date: string, days: number): string =>
  fromUtc(toUtc(date) + days * DAY_MS);

/** Soma meses preservando o dia, e cai no último dia do mês quando ele não existe. */
export const addMonths = (date: string, months: number): string => {
  const { year, month, day } = parseIso(date);
  const index = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return toIso(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
};

export const startOfMonth = (date: string): string => {
  const { year, month } = parseIso(date);
  return toIso(year, month, 1);
};

export const endOfMonth = (date: string): string => {
  const { year, month } = parseIso(date);
  return toIso(year, month, daysInMonth(year, month));
};

export const diffDays = (from: string, to: string): number =>
  Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

export const compareDates = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** `2026-10` — a chave de um mês. */
export const monthKey = (date: string): string => date.slice(0, 7);

/** O primeiro dia do mês `AAAA-MM`. */
export const monthStart = (key: string): string => `${key}-01`;

export const shiftMonthKey = (key: string, months: number): string =>
  monthKey(addMonths(monthStart(key), months));

export const isDateInRange = (date: string, range: DateRange): boolean =>
  date >= range.from && date <= range.to;

export type DateRange = { readonly from: string; readonly to: string };

/** O mês inteiro `AAAA-MM`, do primeiro ao último dia. */
export const monthRange = (key: string): DateRange => ({
  from: monthStart(key),
  to: endOfMonth(monthStart(key)),
});

/** O período imediatamente anterior, do mesmo tamanho (RN-62). Para um mês, o mês anterior. */
export const comparisonRange = (range: DateRange): DateRange => {
  const wholeMonth =
    range.from === startOfMonth(range.from) && range.to === endOfMonth(range.from);
  if (wholeMonth) return monthRange(shiftMonthKey(monthKey(range.from), -1));
  const length = diffDays(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
};

/** O dia do mês dado, caindo no último dia quando ele não existe (RN-10). */
export const dateInMonth = (anyDateOfMonth: string, day: number): string => {
  const { year, month } = parseIso(anyDateOfMonth);
  return toIso(year, month, Math.min(day, daysInMonth(year, month)));
};

export const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);
export const isMonthKey = (value: string): boolean => /^\d{4}-\d{2}$/.test(value);
