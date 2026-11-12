import {
  MONTH_ABBREVIATIONS,
  WEEKDAY_NAMES,
  daysInMonth,
  parseIso,
  weekdayIndex,
} from './dates.js';
import type { IsoDate } from './dates.js';
import type { Cents } from './money.js';

/**
 * FIN-008 · Formatação.
 *
 * Moeda em reais, milhar por ponto e decimal por vírgula; `−` (U+2212) nas
 * despesas e `+` nas receitas e variações positivas; datas `dd/mm` dentro do ano
 * corrente e `dd/mm/aaaa` fora dele; mês como `out/2026`. Tudo parte de
 * centavos inteiros, e "hoje" é o de São Paulo (`lib/clock.ts`).
 */

export const MINUS_SIGN = '−';

const groupThousands = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** `450000` → `R$ 4.500,00`. Sem sinal: o sinal é decisão de quem mostra. */
export const formatBRL = (cents: Cents): string => {
  const absolute = Math.abs(Math.trunc(cents));
  const whole = Math.trunc(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `R$ ${groupThousands(String(whole))},${fraction}`;
};

/** Com sinal explícito: `−R$ 4.500,00`, `+R$ 350,00`; zero não leva sinal. */
export const formatSignedBRL = (cents: Cents): string => {
  if (cents === 0) return formatBRL(0);
  return `${cents < 0 ? MINUS_SIGN : '+'}${formatBRL(cents)}`;
};

/** `21/10` no ano de `today`, `21/10/2025` fora dele. */
export const formatDay = (date: IsoDate, today: IsoDate): string => {
  const { year, month, day } = parseIso(date);
  const base = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
  return year === parseIso(today).year ? base : `${base}/${year}`;
};

/** O cabeçalho de dia: `Quarta, 21/10`. */
export const formatDayHeader = (date: IsoDate, today: IsoDate): string =>
  `${WEEKDAY_NAMES[weekdayIndex(date)] ?? ''}, ${formatDay(date, today)}`;

/** `out/2026`. */
export const formatMonth = (date: IsoDate): string => {
  const { year, month } = parseIso(date);
  return `${MONTH_ABBREVIATIONS[month - 1] ?? ''}/${year}`;
};

/** `out`, para o eixo dos gráficos. */
export const formatMonthShort = (date: IsoDate): string =>
  MONTH_ABBREVIATIONS[parseIso(date).month - 1] ?? '';

/** `dia 24 de 31`. */
export const formatDayOfMonth = (date: IsoDate): string => {
  const { year, month, day } = parseIso(date);
  return `dia ${day} de ${daysInMonth(year, month)}`;
};

/**
 * RN-64 · Percentuais em uma casa decimal ajustados para somar 100%.
 *
 * Método do maior resto: cada parte recebe o piso em décimos de ponto e os
 * décimos que faltam vão para as maiores partes fracionárias. Devolve décimos de
 * ponto percentual (`475` = 47,5%), para a soma ser exata.
 */
export const allocatePercentTenths = (values: readonly number[]): readonly number[] => {
  const total = values.reduce((acc, value) => acc + value, 0);
  if (total <= 0) return values.map(() => 0);

  const exact = values.map((value) => (value * 1000) / total);
  const floors = exact.map(Math.floor);
  let missing = 1000 - floors.reduce((acc, value) => acc + value, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const result = [...floors];
  for (const { index } of order) {
    if (missing <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    missing -= 1;
  }
  return result;
};

/** `475` → `47,5%`. */
export const formatPercentTenths = (tenths: number): string =>
  `${(tenths / 10).toFixed(1).replace('.', ',')}%`;

/** Variação entre dois valores, inteira e com sinal: `−34%`, `+0%`. */
export const formatChangePercent = (current: Cents, previous: Cents): string | null => {
  if (previous === 0) return null;
  const percent = Math.round(((current - previous) * 100) / previous);
  if (percent === 0) return '+0%';
  return `${percent < 0 ? MINUS_SIGN : '+'}${Math.abs(percent)}%`;
};

/**
 * Texto de campo de dinheiro (`1.234,56`) → centavos. Aceita vírgula decimal e
 * ponto de milhar; recusa o que não é valor.
 */
export const parseMoneyInput = (text: string): Cents | null => {
  const clean = text.replace(/R\$|\s/g, '');
  if (clean === '' || !/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(clean))
    return null;
  const [whole = '', fraction = ''] = clean.replaceAll('.', '').split(',');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};
