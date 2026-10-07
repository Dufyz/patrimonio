/**
 * Aritmética de data sobre `YYYY-MM-DD`, sem fuso e sem `new Date()` de "agora".
 * O motor não conhece `DateOnly` de `@patrimonio/domain` de propósito: `calc` não
 * declara dependência nenhuma além de utilitário puro, e é isso que o mantém
 * compilável e testável isolado.
 */
const MS_PER_DAY = 86_400_000;

const utc = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);

/** Dias corridos entre duas datas. A alíquota regressiva conta dia corrido. */
export const calendarDaysBetween = (from: string, to: string): number =>
  Math.round((utc(to) - utc(from)) / MS_PER_DAY);

export const addCalendarDays = (date: string, days: number): string =>
  new Date(utc(date) + days * MS_PER_DAY).toISOString().slice(0, 10);

/** O primeiro dia do mês, que é a fronteira da apuração mensal. */
export const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;

export const monthOf = (date: string): string => date.slice(0, 7);

/**
 * Soma meses mantendo o dia, e recuando quando o mês de destino é mais curto —
 * 31 de janeiro mais um mês é 28 de fevereiro, não 3 de março.
 */
export const addMonths = (date: string, months: number): string => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));

  const target = month - 1 + months;
  const targetYear = year + Math.floor(target / 12);
  const targetMonth = ((target % 12) + 12) % 12;

  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);

  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
};

/** Meses cheios entre duas datas; 15/01 a 10/03 são dois meses, não três. */
export const monthsBetween = (from: string, to: string): number => {
  const months =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

  return Number(to.slice(8, 10)) < Number(from.slice(8, 10)) ? months - 1 : months;
};
