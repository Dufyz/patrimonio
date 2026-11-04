/**
 * Datas de negócio de Finanças: `YYYY-MM-DD` do início ao fim, sempre como
 * texto. Nenhuma função aqui cria `Date` no fuso do navegador, porque um `Date`
 * de `2026-10-01` lido em outro fuso vira 30/09 — o deslocamento de um dia que
 * faz uma compra cair na fatura errada.
 */

export type IsoDate = string;

export const MONTH_ABBREVIATIONS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

export const WEEKDAY_NAMES = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

export const parseIso = (date: IsoDate): { year: number; month: number; day: number } => {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
};

export const toIso = (year: number, month: number, day: number): IsoDate =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const toUtc = (date: IsoDate): number => {
  const { year, month, day } = parseIso(date);
  return Date.UTC(year, month - 1, day);
};

const fromUtc = (ms: number): IsoDate => {
  const value = new Date(ms);
  return toIso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
};

const DAY_MS = 86_400_000;

export const addDays = (date: IsoDate, days: number): IsoDate =>
  fromUtc(toUtc(date) + days * DAY_MS);

/** Soma meses preservando o dia, e cai no último dia do mês quando ele não existe. */
export const addMonths = (date: IsoDate, months: number): IsoDate => {
  const { year, month, day } = parseIso(date);
  const index = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return toIso(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
};

export const startOfMonth = (date: IsoDate): IsoDate => {
  const { year, month } = parseIso(date);
  return toIso(year, month, 1);
};

export const endOfMonth = (date: IsoDate): IsoDate => {
  const { year, month } = parseIso(date);
  return toIso(year, month, daysInMonth(year, month));
};

/** Dias entre duas datas: positivo quando `to` é depois de `from`. */
export const diffDays = (from: IsoDate, to: IsoDate): number =>
  Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

export const compareDates = (a: IsoDate, b: IsoDate): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** `2026-10` — a chave de um mês. */
export const monthKey = (date: IsoDate): string => date.slice(0, 7);

export const weekdayIndex = (date: IsoDate): number => new Date(toUtc(date)).getUTCDay();

export const isDateInRange = (
  date: IsoDate,
  range: { from: IsoDate; to: IsoDate },
): boolean => date >= range.from && date <= range.to;

/**
 * O dia calendário em São Paulo para um instante. `Intl` com o fuso nomeado,
 * não `getDate()`: às 23h de 03/11 em São Paulo já é 04/11 em UTC.
 */
export const saoPauloDate = (now: Date): IsoDate => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};
