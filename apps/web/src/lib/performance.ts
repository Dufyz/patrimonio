import type {
  PerformanceBenchmarkResource,
  PerformanceResource,
} from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';

import type { Series } from './chart/series.js';
import { percentAsRatio } from './overview.js';
import { BENCHMARK_COLOR, colorForSeries } from './tokens.js';

/**
 * As decisões do retorno na Visão geral (gráfico contra benchmarks, janelas e classes).
 *
 * Nada aqui soma dinheiro nem calcula retorno: o que chega da `api` é o que a
 * tela mostra. O que é decidido aqui é o que a tela precisa resolver antes de
 * desenhar — qual cor cada linha leva, que rótulo cada janela tem, como o
 * gráfico recebe percentuais e como o método é dito em palavras.
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

/** `2026-06` ou `2026-06-30` → `jun/26`. */
export const shortMonth = (value: string): string => {
  const month = MONTHS[Number(value.slice(5, 7)) - 1] ?? '';
  return `${month}/${value.slice(2, 4)}`;
};

/**
 * O cabeçalho de cada janela. A do mês e a do início carregam a data, porque
 * "mês" e "início" só significam alguma coisa com ela: `SET/26`, `INÍCIO · MAR/21`.
 */
export const windowLabel = (
  key: string,
  context: { readonly referenceDate: string | null; readonly inception: string | null },
): string => {
  switch (key) {
    case 'month':
      return context.referenceDate === null
        ? 'Mês'
        : shortMonth(context.referenceDate).toUpperCase();
    case 'ytd':
      return 'YTD';
    case 'inception':
      return context.inception === null
        ? 'Início'
        : `Início · ${shortMonth(context.inception).toUpperCase()}`;
    default:
      return key.toUpperCase();
  }
};

/**
 * A cor de cada linha, na ordem da tela: a carteira é sempre a primeira cor, o
 * benchmark de referência é o tracejado escuro, e os demais seguem a paleta.
 */
export const benchmarkColor = (position: number): string =>
  position === 0 ? BENCHMARK_COLOR : colorForSeries(position);

export const PORTFOLIO_COLOR = 'var(--color-accent)';

/** O que o gráfico desenha: carteira e benchmarks em razão, como o formatador espera. */
export const chartSeries = (
  chart: PerformanceResource['chart'],
  selected: readonly PerformanceBenchmarkResource[],
  portfolioName: string,
): readonly Series[] => {
  const dates = chart.dates as readonly DateOnly[];

  const points = (values: readonly string[]) =>
    dates.map((date, index) => ({ date, value: percentAsRatio(values[index] ?? null) }));

  return [
    {
      id: 'carteira',
      label: portfolioName,
      color: PORTFOLIO_COLOR,
      points: points(chart.portfolio),
      area: true,
    },
    ...chart.benchmarks.flatMap((entry) => {
      const position = selected.findIndex((item) => item.id === entry.id);
      const benchmark = selected[position];
      if (benchmark === undefined) return [];

      return [
        {
          id: entry.id,
          label: benchmark.name,
          color: benchmarkColor(position),
          dashed: position === 0,
          points: points(entry.values),
        },
      ];
    }),
  ];
};

/** O benchmark que a pessoa pode tirar da tela: o de referência fica. */
export const extraBenchmarks = (
  selected: readonly PerformanceBenchmarkResource[],
  primaryId: string | null,
): readonly PerformanceBenchmarkResource[] =>
  selected.filter((item) => item.id !== primaryId);

export const addBenchmark = (ids: readonly string[], id: string): readonly string[] =>
  ids.includes(id) ? ids : [...ids, id];

export const removeBenchmark = (ids: readonly string[], id: string): readonly string[] =>
  ids.filter((item) => item !== id);

/** O que ainda cabe escolher: o catálogo menos o que já está na tela. */
export const availableToAdd = (
  resource: PerformanceResource['benchmarks'],
): readonly PerformanceBenchmarkResource[] =>
  resource.available.filter(
    (item) => !resource.selected.some((chosen) => chosen.id === item.id),
  );
