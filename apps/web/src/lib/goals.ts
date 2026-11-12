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
  on_track: 'No ritmo',
  behind: 'Abaixo do ritmo',
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
    'A carteira deste objetivo ainda não foi consolidada: a projeção começa na primeira consolidação.',
};

/** O que vem depois do valor da meta: prazo e premissa, nessa ordem. */
export const goalCaptionTail = (goal: GoalResource): string =>
  [
    monthYearLabel(goal.target_date),
    goal.rate === null || goal.rate.assumption === null
      ? 'sem premissa'
      : `premissa ${goal.rate.assumption}`,
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
  custom: 'seu valor',
  option: '',
};

/** Rótulo da média: o número de meses que realmente entraram nela. */
export const paceLabel = (months: number): string => `média ${months}M`;

/* -------------------------------------------------------------------------- */
/* A taxa na URL                                                               */

/**
 * `taxa=6`. A taxa trocada é da sessão, não do objetivo: ela vive na
 * URL para poder ser compartilhada e recarregada, e nunca é gravada.
 */
export const RATE_PATTERN = /^\d{1,3}(\.\d{1,4})?$/;

/** Aceita a vírgula decimal que quem digita em português usa. */
export const normalizeRateInput = (text: string): string | null => {
  const value = text.trim().replace(',', '.').replace(/%$/, '');
  return RATE_PATTERN.test(value) && Number(value) <= 100 ? value : null;
};

/* -------------------------------------------------------------------------- */
/* O gráfico                                                                   */

export const PACE_COLOR = 'var(--color-accent)';
export const REQUIRED_COLOR = 'var(--color-ink-3)';

export const chartSeries = (goal: GoalResource): readonly Series[] => {
  if (goal.chart === null) return [];
  const { dates, pace, required, plan } = goal.chart;
  const series: Series[] = [
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

  if (plan !== null) {
    series.push({
      id: 'plan',
      label: 'Com o aporte simulado',
      color: 'var(--color-positive)',
      points: dates.map((date, index) => ({
        date: date as DateOnly,
        value: plan[index] ?? null,
      })),
    });
  }

  return series;
};

/* -------------------------------------------------------------------------- */
/* Contra o prazo                                                              */

export type Lateness = {
  readonly text: string;
  readonly tone: 'positive' | 'attention';
};

/**
 * Quanto a chegada se afasta do prazo, dito em meses: `+21 meses`, `no prazo`,
 * `6 meses antes`. Os dois números chegam da `api`; aqui só se subtrai.
 */
export const latenessOf = (
  monthsToArrival: number | null,
  monthsRemaining: number | null,
): Lateness | null => {
  if (monthsToArrival === null || monthsRemaining === null) return null;
  const diff = monthsToArrival - monthsRemaining;
  const unit = (n: number): string => (n === 1 ? 'mês' : 'meses');

  if (diff > 0) return { text: `+${diff} ${unit(diff)}`, tone: 'attention' };
  if (diff === 0) return { text: 'no prazo', tone: 'positive' };
  return { text: `${-diff} ${unit(-diff)} antes`, tone: 'positive' };
};

/** `IPCA+6` → `IPCA + 6%`: a premissa como a prancha a escreve. */
export const assumptionLabel = (assumption: string | null): string | null => {
  if (assumption === null) return null;
  const text = assumption.replace(/\s*\+\s*/g, ' + ');
  return /[%]/.test(text) ? text : /\d$/.test(text) ? `${text}%` : text;
};

/* -------------------------------------------------------------------------- */
/* O formulário                                                                */

export const OTHER_ASSUMPTION = 'other';

/** As premissas que se escolhem de uma lista; o resto é "Outra", digitada. */
export const ASSUMPTION_PRESETS: readonly {
  readonly id: string;
  readonly name: string;
}[] = [
  { id: 'IPCA+4', name: 'IPCA + 4%' },
  { id: 'IPCA+5', name: 'IPCA + 5%' },
  { id: 'IPCA+6', name: 'IPCA + 6%' },
  { id: 'IPCA+7', name: 'IPCA + 7%' },
  { id: 'IPCA+8', name: 'IPCA + 8%' },
  { id: '8', name: 'Taxa fixa 8% a.a.' },
  { id: '10', name: 'Taxa fixa 10% a.a.' },
  { id: '12', name: 'Taxa fixa 12% a.a.' },
  { id: OTHER_ASSUMPTION, name: 'Outra…' },
];

export type GoalForm = {
  readonly name: string;
  /** Mascarado, como o campo mostra: `400.000,00`. */
  readonly amount: string;
  /** `jun/2030` ou `06/2030`. */
  readonly date: string;
  /** O id de uma premissa da lista, ou `OTHER_ASSUMPTION`. */
  readonly assumption: string;
  readonly otherAssumption: string;
  readonly valuesIn: 'today' | 'target';
};

export type GoalFormErrors = Partial<
  Record<'name' | 'amount' | 'date' | 'assumption', string>
>;

const squash = (text: string): string =>
  text.replace(/\s+/g, '').replace('%', '').toLowerCase();

const presetOf = (assumption: string | null): string | null => {
  if (assumption === null) return null;
  const wanted = squash(assumption);
  return ASSUMPTION_PRESETS.find((preset) => squash(preset.id) === wanted)?.id ?? null;
};

export const DEFAULT_ASSUMPTION = 'IPCA+6';

export const emptyGoalForm = (): GoalForm => ({
  name: '',
  amount: '',
  date: '',
  assumption: DEFAULT_ASSUMPTION,
  otherAssumption: '',
  valuesIn: 'today',
});

/** `400000.00` → `400.000,00`: o que o campo de dinheiro mostra ao abrir. */
const maskedAmount = (value: string): string => {
  const [integer = '0', fraction = '00'] = value.split('.');
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction.padEnd(2, '0').slice(0, 2)}`;
};

export const formFromGoal = (goal: GoalResource | null): GoalForm => {
  if (goal === null) return emptyGoalForm();

  const preset = presetOf(goal.return_assumption);

  return {
    name: goal.name,
    amount: maskedAmount(goal.target_amount),
    date: monthYearInput(goal.target_date),
    assumption:
      goal.return_assumption === null ? DEFAULT_ASSUMPTION : (preset ?? OTHER_ASSUMPTION),
    otherAssumption: preset === null ? (goal.return_assumption ?? '') : '',
    valuesIn: goal.amount_in_today_brl ? 'today' : 'target',
  };
};

/** `2030-06-30` → `jun/2030`; vazio quando não há data. */
export const monthYearInput = (date: string | null): string =>
  date === null ? '' : monthYearLabel(date);

/**
 * O que se digita numa data de objetivo: `jun/2030`, `06/2030` ou `6/2030`. O
 * objetivo tem prazo de mês, então a data guardada é o último dia dele.
 */
export const parseMonthYear = (typed: string): string | null => {
  const match = /^\s*(\d{1,2}|[a-zç]{3})\s*\/\s*(\d{4})\s*$/i.exec(typed);
  if (match === null) return null;

  const [, rawMonth = '', rawYear = ''] = match;
  const month = /^\d+$/.test(rawMonth)
    ? Number(rawMonth)
    : MONTHS.indexOf(rawMonth.toLowerCase() as (typeof MONTHS)[number]) + 1;
  const year = Number(rawYear);

  if (month < 1 || month > 12 || year < 1900 || year > 2200) return null;

  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${rawYear}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
};

/** `1.234,50` → `1234.50`, ou nulo quando não é um valor maior que zero. */
const positiveAmount = (typed: string): string | null => {
  const text = typed.trim();
  if (text === '') return null;
  const normalized = text.includes(',')
    ? text.replaceAll('.', '').replace(',', '.')
    : text.replaceAll('.', '');

  return /^\d+(\.\d+)?$/.test(normalized) && Number(normalized) > 0 ? normalized : null;
};

/**
 * O formulário contra o contrato: ou o corpo do `PUT`, ou o erro de cada campo.
 * A premissa digitada em "Outra" é conferida pela `api`, que é quem sabe lê-la.
 * Sem mudança na data digitada, a data guardada fica como está.
 */
export const goalFormResult = (
  form: GoalForm,
  original: GoalResource | null,
):
  | { readonly body: GoalBodyShape; readonly errors: Record<string, never> }
  | { readonly body: null; readonly errors: GoalFormErrors } => {
  const errors: { -readonly [K in keyof GoalFormErrors]: string } = {};

  const name = form.name.trim();
  if (name === '') errors.name = 'Dê um nome ao objetivo.';

  const amount = positiveAmount(form.amount);
  if (amount === null) errors.amount = 'Informe um valor maior que zero.';

  const unchanged =
    original !== null && form.date.trim() === monthYearInput(original.target_date);
  const date = unchanged ? original.target_date : parseMonthYear(form.date);
  if (date === null) errors.date = 'Use mês e ano, como jun/2030.';

  const assumption =
    form.assumption === OTHER_ASSUMPTION ? form.otherAssumption.trim() : form.assumption;
  if (assumption === '') errors.assumption = 'Informe a premissa, como IPCA+6.';

  if (Object.keys(errors).length > 0 || amount === null || date === null) {
    return { body: null, errors };
  }

  return {
    body: {
      name,
      target_amount: amount,
      target_date: date,
      return_assumption: assumption,
      amount_in_today_brl: form.valuesIn === 'today',
    },
    errors: {},
  };
};

export type GoalBodyShape = {
  readonly name: string;
  readonly target_amount: string;
  readonly target_date: string;
  readonly return_assumption: string | null;
  readonly amount_in_today_brl: boolean;
};
