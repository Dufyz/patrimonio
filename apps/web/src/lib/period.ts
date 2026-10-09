import type { DateOnly } from '@patrimonio/domain';
import { addDays, isDateOnly } from '@patrimonio/domain';

/**
 * D-06 · O período, em string `YYYY-MM-DD` do começo ao fim.
 *
 * Nada aqui usa `Date` com fuso: um `Date` de "2026-10-01" em São Paulo é 30/09
 * em UTC, e esse dia de diferença reaparece no primeiro dia do mês, que é
 * exatamente o que este módulo calcula. As contas acontecem sobre UTC e o que
 * entra e sai é sempre string.
 *
 * O período não conhece dia útil. "Mês" vai do dia 1 até hoje mesmo que hoje
 * seja domingo; é a `api` que alinha o intervalo ao calendário da B3 quando a
 * pergunta exige.
 */

export const PERIOD_PRESETS = [
  'mes',
  'mes_anterior',
  '3m',
  'ytd',
  '12m',
  '24m',
  'inicio',
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export type Period =
  | { readonly kind: 'preset'; readonly preset: PeriodPreset }
  | { readonly kind: 'custom'; readonly from: DateOnly; readonly to: DateOnly };

export const DEFAULT_PERIOD: Period = { kind: 'preset', preset: '12m' };

export type Range = { readonly from: DateOnly; readonly to: DateOnly };

/** Os botões da barra, na ordem da prancha 03. O resto vive no calendário. */
export const PERIOD_BUTTONS: readonly PeriodPreset[] = [
  'mes',
  'ytd',
  '12m',
  '24m',
  'inicio',
];

export const PERIOD_LABELS: Readonly<Record<PeriodPreset, string>> = {
  mes: 'Mês',
  mes_anterior: 'Mês anterior',
  '3m': 'Últimos 3 meses',
  ytd: 'YTD',
  '12m': '12M',
  '24m': '24M',
  inicio: 'Início',
};

/** Os atalhos que o calendário de período personalizado oferece. */
export const PERIOD_SHORTCUTS: readonly { preset: PeriodPreset; label: string }[] = [
  { preset: 'mes', label: 'Este mês' },
  { preset: 'mes_anterior', label: 'Mês anterior' },
  { preset: '3m', label: 'Últimos 3 meses' },
  { preset: 'ytd', label: 'Ano até hoje' },
  { preset: '12m', label: '12 meses' },
  { preset: 'inicio', label: 'Desde o início' },
];

const parts = (date: DateOnly): { year: number; month: number; day: number } => {
  const [year = '0', month = '1', day = '1'] = date.split('-');
  return { year: Number(year), month: Number(month), day: Number(day) };
};

const compose = (year: number, month: number, day: number): DateOnly =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    day,
  ).padStart(2, '0')}`;

export const startOfMonth = (date: DateOnly): DateOnly => {
  const { year, month } = parts(date);
  return compose(year, month, 1);
};

export const startOfYear = (date: DateOnly): DateOnly => `${parts(date).year}-01-01`;

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Soma meses mantendo o dia, e encurtando quando o mês de destino é mais
 * curto: 31 de março menos um mês é 28 de fevereiro, não 3 de março.
 */
export const addMonths = (date: DateOnly, months: number): DateOnly => {
  const { year, month, day } = parts(date);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  return compose(
    targetYear,
    targetMonth,
    Math.min(day, daysInMonth(targetYear, targetMonth)),
  );
};

export const endOfMonth = (date: DateOnly): DateOnly => {
  const { year, month } = parts(date);
  return compose(year, month, daysInMonth(year, month));
};

/**
 * O intervalo que o período representa hoje. `inception` é a data do primeiro
 * lançamento da carteira; sem ela, "Início" não tem como ser diferente de
 * "tudo que existe", e o começo fica no próprio hoje.
 */
export const resolvePeriod = (
  period: Period,
  today: DateOnly,
  inception: DateOnly | null,
): Range => {
  if (period.kind === 'custom') return { from: period.from, to: period.to };

  switch (period.preset) {
    case 'mes':
      return { from: startOfMonth(today), to: today };
    case 'mes_anterior': {
      const previous = addMonths(startOfMonth(today), -1);
      return { from: previous, to: endOfMonth(previous) };
    }
    case '3m':
      return { from: addDays(addMonths(today, -3), 1), to: today };
    case 'ytd':
      return { from: startOfYear(today), to: today };
    case '12m':
      return { from: addDays(addMonths(today, -12), 1), to: today };
    case '24m':
      return { from: addDays(addMonths(today, -24), 1), to: today };
    case 'inicio':
      return { from: inception ?? today, to: today };
  }
};

/** `2026-10-06` → `06/10`. O ano só aparece quando não é o de referência. */
export const formatDayMonth = (date: DateOnly, reference: DateOnly): string => {
  const { year, month, day } = parts(date);
  const short = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
  return year === parts(reference).year ? short : `${short}/${String(year).slice(2)}`;
};

/** `01/09 – 06/10`, como o botão de período personalizado mostra. */
export const formatRange = (range: Range, today: DateOnly): string =>
  `${formatDayMonth(range.from, today)} – ${formatDayMonth(range.to, today)}`;

export const isPeriodPreset = (value: unknown): value is PeriodPreset =>
  typeof value === 'string' && (PERIOD_PRESETS as readonly string[]).includes(value);

/**
 * `12m` ou `2026-09-01..2026-10-06`. O período precisa caber na URL para que a
 * tela possa ser compartilhada e recarregada no mesmo estado.
 */
export const encodePeriod = (period: Period): string =>
  period.kind === 'preset' ? period.preset : `${period.from}..${period.to}`;

export const decodePeriod = (raw: string | null): Period => {
  if (raw === null) return DEFAULT_PERIOD;
  if (isPeriodPreset(raw)) return { kind: 'preset', preset: raw };

  const [from, to] = raw.split('..');
  if (from === undefined || to === undefined) return DEFAULT_PERIOD;
  if (!isDateOnly(from) || !isDateOnly(to)) return DEFAULT_PERIOD;
  // Intervalo invertido é erro de digitação na URL, não um pedido: o período
  // volta ao padrão em vez de desenhar uma tela vazia sem explicação.
  if (from > to) return DEFAULT_PERIOD;

  return { kind: 'custom', from, to };
};
