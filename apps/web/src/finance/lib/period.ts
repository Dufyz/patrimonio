import {
  addDays,
  addMonths,
  diffDays,
  endOfMonth,
  parseIso,
  startOfMonth,
} from './dates.js';
import type { IsoDate } from './dates.js';

/**
 * FIN-003 · O período de uma tela de Finanças: um intervalo livre de datas.
 * O padrão é o mês corrente, do dia 1 ao último dia do mês.
 */

export type DateRange = { readonly from: IsoDate; readonly to: IsoDate };

export const currentMonth = (today: IsoDate): DateRange => ({
  from: startOfMonth(today),
  to: endOfMonth(today),
});

export const previousMonth = (today: IsoDate): DateRange =>
  currentMonth(addMonths(startOfMonth(today), -1));

export const last12Months = (today: IsoDate): DateRange => ({
  from: startOfMonth(addMonths(today, -11)),
  to: endOfMonth(today),
});

export const PERIOD_SHORTCUTS = [
  { id: 'current', label: 'Mês atual', range: currentMonth },
  { id: 'previous', label: 'Mês anterior', range: previousMonth },
  { id: 'last12', label: 'Últimos 12 meses', range: last12Months },
] as const;

export type PeriodShortcutId = (typeof PERIOD_SHORTCUTS)[number]['id'];

export const shortcutFor = (range: DateRange, today: IsoDate): PeriodShortcutId | null =>
  PERIOD_SHORTCUTS.find((shortcut) => {
    const candidate = shortcut.range(today);
    return candidate.from === range.from && candidate.to === range.to;
  })?.id ?? null;

const dayMonth = (date: IsoDate): string => {
  const { month, day } = parseIso(date);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
};

const dayMonthYear = (date: IsoDate): string =>
  `${dayMonth(date)}/${parseIso(date).year}`;

/** `dd/mm` dentro do ano de `today`, `dd/mm/aaaa` fora dele. */
export const formatDate = (date: IsoDate, today: IsoDate): string =>
  parseIso(date).year === parseIso(today).year ? dayMonth(date) : dayMonthYear(date);

/** `01/10 – 31/10`, como o botão do cabeçalho mostra. */
export const formatRange = (range: DateRange, today: IsoDate): string =>
  `${formatDate(range.from, today)} – ${formatDate(range.to, today)}`;

/** O intervalo imediatamente anterior, com a mesma duração. */
export const precedingRange = (range: DateRange): DateRange => {
  const length = diffDays(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
};

/** O período é exatamente um mês de calendário? */
export const isWholeMonth = (range: DateRange): boolean =>
  range.from === startOfMonth(range.from) && range.to === endOfMonth(range.from);

/**
 * RN-62: o mês corrente é comparado com o mês anterior completo; um intervalo
 * livre, com o intervalo imediatamente anterior de mesma duração.
 */
export const comparisonRange = (range: DateRange): DateRange =>
  isWholeMonth(range) ? currentMonth(addMonths(range.from, -1)) : precedingRange(range);
