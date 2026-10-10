import type { GoalResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';

import type { Series } from './chart/series.js';

/**
 * T-07 · O que a tela de Objetivos decide sozinha: texto, cor e ordem. Conta
 * nenhuma — progresso, projeção e trajetórias chegam prontos da `api`.
 */

const MONTHS = [
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

/** `2043-03-15` → `mar/2043`. Nulo é "não chega", e a tela diz isso por extenso. */
export const monthYearLabel = (date: string | null): string => {
  if (date === null) return '—';
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  return month === undefined ? '—' : `${month}/${date.slice(0, 4)}`;
};

export type BarState = 'on_track' | 'behind' | 'reached';

/** A barra só sabe três estados; sem projeção ela fica na cor neutra. */
export const barState = (status: GoalResource['status']): BarState =>
  status === 'reached'
    ? 'reached'
    : status === 'behind' || status === 'overdue'
      ? 'behind'
      : 'on_track';

export const STATUS_LABEL: Readonly<Record<GoalResource['status'], string>> = {
  on_track: 'No caminho',
  behind: 'Atrás do necessário',
  overdue: 'Prazo vencido',
  reached: 'Atingido',
  no_projection: 'Sem projeção',
};

export const BLOCK_REASON: Readonly<
  Record<NonNullable<GoalResource['blocked']>, string>
> = {
  no_assumption:
    'Este objetivo não tem premissa de retorno. Sem uma taxa não há projeção — informe uma abaixo para simular.',
  unrecognized_assumption:
    'A premissa guardada não foi entendida (use, por exemplo, IPCA+6 ou 6). Informe uma taxa abaixo para simular.',
  no_inflation:
    'Falta o IPCA dos últimos 12 meses para projetar uma meta em reais da data alvo.',
  no_history:
    'Ainda não há fechamento das carteiras deste objetivo: a projeção começa no primeiro.',
};

/** O que vem depois do valor da meta: prazo, premissa e escopo, nessa ordem. */
export const goalCaptionTail = (goal: GoalResource): string =>
  [
    monthYearLabel(goal.target_date),
    goal.rate === null || goal.rate.assumption === null
      ? 'sem premissa'
      : `premissa ${goal.rate.assumption}`,
    goal.portfolios.all
      ? 'conta o patrimônio todo'
      : `conta só ${goal.portfolios.items.map((item) => item.name).join(', ')}`,
  ].join(' · ');

export const arrivalText = (
  months: number | null,
  date: string | null,
): { readonly text: string; readonly tone: 'positive' | 'attention' | 'negative' } =>
  date === null
    ? { text: 'não chega em 100 anos', tone: 'negative' }
    : months === 0
      ? { text: 'já chegou', tone: 'positive' }
      : { text: monthYearLabel(date), tone: 'attention' };

/** Linhas da tabela de aportes: a cor depende de chegar ou não até a data alvo. */
export const rowTone = (
  row: GoalResource['contributions'][number],
): 'positive' | 'attention' | 'negative' =>
  row.arrival_date === null
    ? 'negative'
    : row.reaches_target_date
      ? 'positive'
      : 'attention';

export const KIND_LABEL: Readonly<
  Record<GoalResource['contributions'][number]['kind'], string>
> = {
  current: 'média',
  required: 'necessário',
  option: '',
};

/** Rótulo da média: o número de meses que realmente entraram nela. */
export const paceLabel = (months: number): string => `média ${months}M`;

/* -------------------------------------------------------------------------- */
/* A taxa na URL                                                               */

/**
 * `taxa=id:6,id:5.5`. A taxa trocada é da sessão, não do objetivo: ela vive na
 * URL para poder ser compartilhada e recarregada, e nunca é gravada.
 */
export const RATE_PATTERN = /^\d{1,3}(\.\d{1,4})?$/;

/** Aceita a vírgula decimal que quem digita em português usa. */
export const normalizeRateInput = (text: string): string | null => {
  const value = text.trim().replace(',', '.').replace(/%$/, '');
  return RATE_PATTERN.test(value) && Number(value) <= 100 ? value : null;
};

export const decodeRates = (raw: string | null): Readonly<Record<string, string>> => {
  if (raw === null || raw === '') return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const [id, rate, ...rest] = part.split(':');
    if (id === undefined || id === '' || rate === undefined || rest.length > 0) continue;
    if (RATE_PATTERN.test(rate) && Number(rate) <= 100) out[id] = rate;
  }
  return out;
};

export const encodeRates = (rates: Readonly<Record<string, string>>): string | null => {
  const entries = Object.entries(rates).toSorted(([a], [b]) => a.localeCompare(b));
  return entries.length === 0
    ? null
    : entries.map(([id, rate]) => `${id}:${rate}`).join(',');
};

export const withRate = (
  rates: Readonly<Record<string, string>>,
  id: string,
  rate: string | null,
): Readonly<Record<string, string>> => {
  const rest = Object.fromEntries(Object.entries(rates).filter(([key]) => key !== id));
  return rate === null ? rest : { ...rest, [id]: rate };
};

/* -------------------------------------------------------------------------- */
/* O gráfico                                                                   */

export const PACE_COLOR = 'var(--color-accent)';
export const REQUIRED_COLOR = 'var(--color-ink-3)';

export const chartSeries = (goal: GoalResource): readonly Series[] => {
  if (goal.chart === null) return [];
  const { dates, pace, required } = goal.chart;
  return [
    {
      id: 'pace',
      label: 'No ritmo atual',
      color: PACE_COLOR,
      points: dates.map((date, index) => ({
        date: date as DateOnly,
        value: pace[index] ?? null,
      })),
    },
    {
      id: 'required',
      label: 'Trajetória necessária',
      color: REQUIRED_COLOR,
      dashed: true,
      points: dates.map((date, index) => ({
        date: date as DateOnly,
        value: required[index] ?? null,
      })),
    },
  ];
};
