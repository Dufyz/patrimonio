import type { GoalsOverviewResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';

import type { Series } from './chart/series.js';

/**
 * T-07 · O que a tela de Objetivos de "Todas as carteiras" decide sozinha:
 * texto, cor e ordem. Conta nenhuma — somas, fatias, datas e o plano de
 * aportes chegam prontos da `api`.
 */

export type Distribution = 'proportional' | 'priority';

export const DISTRIBUTION_OPTIONS: readonly {
  readonly value: Distribution;
  readonly label: string;
  readonly title: string;
}[] = [
  {
    value: 'proportional',
    label: 'Proporcional',
    title: 'Divide o aporte na proporção do que cada carteira precisa',
  },
  {
    value: 'priority',
    label: 'Por prioridade',
    title: 'Enche as carteiras na ordem escolhida, cada uma até o necessário',
  },
];

/* -------------------------------------------------------------------------- */
/* O aporte digitado                                                           */

/**
 * `7.824`, `7824,50`, `R$ 7.824,50` → `7824.50`. O ponto é milhar quando vem
 * seguido de três dígitos; fora disso é decimal. Vazio, zero e o que não é
 * número voltam nulo: o orçamento é sempre positivo.
 */
export const parseBudgetInput = (text: string): string | null => {
  const raw = text.replace(/R\$/gi, '').replace(/\s+/g, '');
  if (raw === '') return null;

  let normalized: string;

  if (raw.includes(',')) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, '');
  } else {
    normalized = raw;
  }

  if (!/^\d{1,12}(\.\d{1,2})?$/.test(normalized)) return null;

  return Number(normalized) > 0 ? normalized : null;
};

/** O orçamento da URL: só o que a `api` aceitaria; o resto volta nulo. */
export const decodeBudget = (raw: string | null): string | null =>
  raw !== null && /^\d{1,12}(\.\d{1,2})?$/.test(raw) && Number(raw) > 0 ? raw : null;

export const decodeDistribution = (raw: string | null): Distribution =>
  raw === 'priority' ? 'priority' : 'proportional';

/** A cascata é o padrão: só `0` a desliga. */
export const decodeCascade = (raw: string | null): boolean => raw !== '0';

/* -------------------------------------------------------------------------- */
/* A ordem de prioridade                                                       */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const decodePriority = (raw: string | null): readonly string[] =>
  raw === null ? [] : raw.split(',').filter((id) => UUID.test(id));

/**
 * A ordem completa: a da URL para quem está nela, e depois as carteiras que
 * faltam, na ordem em que a tabela as mostra. Id que não é mais de uma carteira
 * com meta somada cai fora, para a URL antiga não inventar prioridade.
 */
export const effectivePriority = (
  stored: readonly string[],
  tableOrder: readonly string[],
): readonly string[] => {
  const known = new Set(tableOrder);
  const kept = stored.filter(
    (id, index) => known.has(id) && stored.indexOf(id) === index,
  );

  return [...kept, ...tableOrder.filter((id) => !kept.includes(id))];
};

export const moveInOrder = (
  order: readonly string[],
  id: string,
  delta: -1 | 1,
): readonly string[] => {
  const index = order.indexOf(id);
  const target = index + delta;

  if (index === -1 || target < 0 || target >= order.length) return order;

  const next = [...order];
  const [moved] = next.splice(index, 1);
  if (moved !== undefined) next.splice(target, 0, moved);

  return next;
};

/* -------------------------------------------------------------------------- */
/* Texto                                                                       */

export type Tone = 'positive' | 'attention' | 'negative';

/**
 * A chegada contra o último prazo, em meses: `+21 meses`, `no prazo`,
 * `8 meses antes`. Os meses chegam da `api`; aqui só se escrevem.
 */
export const againstDeadline = (
  months: number | null,
): { readonly text: string; readonly tone: Tone } => {
  if (months === null) return { text: 'não fecha em 100 anos', tone: 'negative' };

  const unit = (value: number): string => (value === 1 ? 'mês' : 'meses');

  if (months > 0) return { text: `+${months} ${unit(months)}`, tone: 'attention' };
  if (months === 0) return { text: 'no prazo', tone: 'positive' };

  return { text: `${-months} ${unit(-months)} antes`, tone: 'positive' };
};

export const SCENARIO_LABEL: Readonly<
  Record<GoalsOverviewResource['scenarios'][number]['kind'], string>
> = {
  current: 'média 12M',
  required: 'necessário',
  option: '',
  custom: 'seu valor',
};

export const EXCLUSION_LABEL: Readonly<
  Record<NonNullable<NonNullable<RowGoal>['excluded_reason']>, string>
> = {
  nominal: 'Meta em reais da data alvo, sem IPCA para converter: fora da soma',
  overdue: 'Prazo vencido: fora da soma',
  no_projection: 'Sem projeção: fora da soma',
};

type RowGoal = GoalsOverviewResource['portfolios'][number]['goal'];

/** O selo do cabeçalho: contra o último prazo, no ritmo atual de cada carteira. */
export const overviewBadge = (
  totals: GoalsOverviewResource['totals'],
): { readonly text: string; readonly tone: Tone } | null => {
  if (totals.counted === 0) return null;
  if (totals.pace_months_vs_deadline === null) {
    return { text: 'Alguma meta não fecha', tone: 'negative' };
  }

  return totals.pace_months_vs_deadline <= 0
    ? { text: 'No ritmo', tone: 'positive' }
    : { text: 'Abaixo do ritmo', tone: 'attention' };
};

type Row = GoalsOverviewResource['portfolios'][number];

/**
 * A ordem da tabela. Por padrão, quem mais se atrasa vem primeiro — é onde a
 * pessoa precisa olhar —, depois as metas fora da soma, depois as carteiras sem
 * objetivo. Na distribuição por prioridade, a ordem é a da fila, para a tabela
 * mostrar o que o aporte vai encher primeiro.
 */
export const sortRows = (
  rows: readonly Row[],
  distribution: Distribution,
  priority: readonly string[],
): readonly Row[] => {
  const rank = (row: Row): number => (row.goal === null ? 2 : row.goal.counted ? 0 : 1);

  const lateness = (row: Row): number => {
    const goal = row.goal;
    if (goal === null || goal.current_months_to_arrival === null) {
      return goal === null ? 0 : Number.POSITIVE_INFINITY;
    }

    return goal.current_months_to_arrival - goal.months_remaining;
  };

  return [...rows].sort((left, right) => {
    if (rank(left) !== rank(right)) return rank(left) - rank(right);

    if (distribution === 'priority' && rank(left) === 0) {
      return priority.indexOf(left.portfolio_id) - priority.indexOf(right.portfolio_id);
    }

    return lateness(right) - lateness(left);
  });
};

/* -------------------------------------------------------------------------- */
/* O gráfico                                                                   */

export const PACE_COLOR = 'var(--color-accent)';
export const REQUIRED_COLOR = 'var(--color-ink-3)';
export const PLAN_COLOR = 'var(--color-positive)';

export const overviewSeries = (
  chart: NonNullable<GoalsOverviewResource['chart']>,
  showPlan: boolean,
): readonly Series[] => {
  const points = (values: readonly string[]) =>
    chart.dates.map((date, index) => ({
      date: date as DateOnly,
      value: values[index] ?? null,
    }));

  return [
    {
      id: 'pace',
      label: 'No ritmo atual',
      color: PACE_COLOR,
      area: true,
      points: points(chart.pace),
    },
    {
      id: 'required',
      label: 'Trajetória necessária',
      color: REQUIRED_COLOR,
      dashed: true,
      points: points(chart.required),
    },
    ...(showPlan
      ? [
          {
            id: 'plan',
            label: 'Com o aporte simulado',
            color: PLAN_COLOR,
            points: points(chart.plan),
          },
        ]
      : []),
  ];
};
