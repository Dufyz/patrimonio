import type {
  PerformanceBenchmarkResource,
  PerformanceDecompositionResource,
  PerformanceMethodResource,
  PerformanceMonthlyResource,
  PerformanceResource,
} from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';

import type { Series } from './chart/series.js';
import { percentAsRatio } from './overview.js';
import { BENCHMARK_COLOR, colorForSeries } from './tokens.js';
import type { GridYear } from '../components/month_year_grid.js';

/**
 * T-05 · As decisões da tela de Desempenho.
 *
 * Nada aqui soma dinheiro nem calcula retorno: o que chega da `api` é o que a
 * tela mostra. O que é decidido aqui é o que a tela precisa resolver antes de
 * desenhar — qual cor cada linha leva, que rótulo cada janela tem, como a
 * grade e o gráfico recebem percentuais e como o método é dito em palavras.
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

export const PORTFOLIO_COLOR = colorForSeries(0);

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

/**
 * A grade mês × ano, com as duas colunas à direita da prancha: o benchmark do
 * ano e a diferença em pontos. Percentual vira razão; a diferença fica em pontos.
 */
export const gridYears = (monthly: PerformanceMonthlyResource): readonly GridYear[] =>
  monthly.years.map((year) => ({
    year: year.year,
    months: year.months.map((value) => percentAsRatio(value)),
    total: percentAsRatio(year.total_pct),
    extras: [percentAsRatio(year.benchmark_pct), year.difference_pp],
    partial: year.partial,
  }));

/** O método dito em palavras: a tela declara como cada número foi calculado. */
export const methodLines = (
  method: PerformanceMethodResource,
): readonly { readonly label: string; readonly text: string }[] => [
  {
    label: 'Carteira',
    text: 'variação da cota gravada da carteira. Aporte e resgate criam ou desfazem cotas e não mexem no valor delas — por isso aporte não vira rentabilidade.',
  },
  {
    label: 'Classes',
    text: 'retorno de Dietz modificado: o ganho do período sobre o capital médio investido, com cada fluxo pesando pelo tempo em que ficou na classe. É uma aproximação — a classe não tem cota — e o caixa fica de fora, porque não rende por si.',
  },
  {
    label: 'Benchmarks',
    text: 'produto dos fatores diários do índice, entre as mesmas datas da carteira. Índice sem dado no período aparece como traço, não como zero.',
  },
  {
    label: 'Janelas',
    text: method.annualized
      ? 'anualizadas.'
      : 'nada é anualizado. Janela maior que o histórico da carteira aparece como traço.',
  },
];

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */

const CSV_HEADER = [
  'Mês',
  'Saldo inicial',
  'Aportes - resgates',
  'Rendimento',
  'Dos quais proventos',
  'Saldo final',
  'Rentabilidade (%)',
  'Benchmark (%)',
  'Diferença (pp)',
] as const;

const quoted = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/** Decimal com vírgula, que é o que a planilha em português entende. */
const decimalComma = (value: string | null): string =>
  value === null ? '' : value.replace('.', ',');

/**
 * O CSV da decomposição, com `;` e vírgula decimal, e os valores como a `api`
 * os mandou — o arquivo é para conferir, e conferir é com o número inteiro. A
 * última linha é o total do período.
 */
export const decompositionCsv = (
  decomposition: PerformanceDecompositionResource,
): string => {
  const line = (label: string, row: PerformanceDecompositionResource['rows'][number]) =>
    [
      label,
      decimalComma(row.opening_value),
      decimalComma(row.net_flow),
      decimalComma(row.income),
      decimalComma(row.payouts),
      decimalComma(row.closing_value),
      decimalComma(row.return_pct),
      decimalComma(row.benchmark_pct),
      decimalComma(row.difference_pp),
    ]
      .map(quoted)
      .join(';');

  const rows = decomposition.rows.map((row) => line(shortMonth(row.month), row));
  const total = decomposition.total;

  return [
    CSV_HEADER.map(quoted).join(';'),
    ...rows,
    ...(total === null ? [] : [line(`${total.months} meses`, { month: '', ...total })]),
  ].join('\r\n');
};

export const CSV_BOM = '﻿';

export const csvFilename = (today: DateOnly): string => `desempenho-${today}.csv`;
