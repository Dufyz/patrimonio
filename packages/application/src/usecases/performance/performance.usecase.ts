import {
  WINDOWS,
  addCalendarDays,
  addMonths,
  benchmarkCumulative,
  buildQuotaSeries,
  benchmarkPeriodReturn,
  cumulativeReturns,
  differencePp,
  indexCodesOf,
  measurementCalendar,
  modifiedDietz,
  resolveWindow,
  returnPct,
  sumValues,
  weightPct,
  windowStart,
} from '@patrimonio/calc';
import type {
  BenchmarkDefinition,
  BenchmarkSpec,
  DecompositionDay,
  QuotaPoint,
  WindowKey,
  WindowReturn,
} from '@patrimonio/calc';
import {
  INDEX_CODES,
  benchmarkLabel,
  formatBenchmark,
  parseBenchmark,
} from '@patrimonio/domain';
import type { DateOnly, RecalcStatus } from '@patrimonio/domain';
import { either, failure } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type {
  PerformanceBreakdown,
  PerformanceDayRow,
  PerformancePoint,
  PerformanceRepository,
  PerformanceSnapshot,
} from '../../interfaces/performance.repository.js';

/**
 * A tela de Desempenho, que responde a pergunta que motivou o produto: **quanto
 * do crescimento veio de aporte e quanto veio de rentabilidade**.
 *
 * ## Por que a carteira é medida pela cota
 *
 * Patrimônio de hoje menos patrimônio de ontem mistura dois dinheiros: o que o
 * mercado fez e o que a pessoa aportou. Um mês de aporte grande e mercado
 * caindo parece um mês bom. A cota separa os dois — o aporte entra ao valor de
 * cota do dia anterior, cria cotas e não mexe no preço delas —, e o retorno de
 * qualquer janela é a razão entre duas cotas. É também o que mantém esta rota
 * barata: cada janela sai de duas linhas da série.
 *
 * ## Por que a classe de ativo usa outro método
 *
 * Uma classe não tem cota: as ações recebem dinheiro quando se compra e devolvem
 * quando se vende, e ninguém grava quantas cotas "de ações" existem. O retorno
 * dela é Dietz modificado (`modifiedDietz`), que é uma aproximação — e por isso a
 * tela a declara. A carteira nunca usa Dietz.
 *
 * ## O benchmark mede os mesmos dias
 *
 * Todo benchmark é medido entre as **mesmas duas datas** da carteira: a base é o
 * fechamento de onde a janela parte, e é a data da própria linha-base da cota,
 * não a data nominal da janela. Comparar a carteira de 03/03 a 30/09 com um
 * índice de 01/03 a 30/09 compararia períodos diferentes.
 */

export type PerformanceScope = {
  /** Nulo em Todas as carteiras. */
  readonly portfolio_id: string | null;
  readonly name: string;
  readonly recalc_status: RecalcStatus;
  readonly inception: DateOnly | null;
};

export type PerformanceBenchmark = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'index' | 'index_plus_rate' | 'percent_of_index';
};

export type PerformanceMethod = {
  readonly portfolio: 'portfolio_quota';
  readonly class: 'modified_dietz';
  readonly benchmark: 'compound_daily_factors';
  readonly annualized: false;
};

export type PerformanceChart = {
  readonly base_date: DateOnly | null;
  readonly dates: readonly DateOnly[];
  readonly portfolio: readonly string[];
  readonly benchmarks: readonly {
    readonly id: string;
    readonly values: readonly string[];
  }[];
};

export type PerformanceWindowColumn = {
  readonly key: WindowKey;
  readonly base_date: DateOnly | null;
};

export type PerformanceWindowRow = {
  readonly kind: 'portfolio' | 'benchmark' | 'difference';
  readonly benchmark: string | null;
  readonly name: string;
  readonly values: readonly (string | null)[];
};

export type BreakdownKey = 'month' | 'ytd' | '12m' | 'inception';

export type PerformanceClassRow = {
  readonly category_id: string;
  readonly name: string;
  readonly color_token: string;
  readonly value: string;
  readonly weight_pct: string;
  readonly returns: readonly (string | null)[];
};

/**
 * O retorno de cada carteira, pela cota dela. Só existe em Todas as carteiras: é
 * a leitura que a soma esconde.
 */
export type PerformancePortfolioRow = {
  readonly portfolio_id: string;
  readonly name: string;
  readonly value: string;
  readonly weight_pct: string;
  readonly returns: readonly (string | null)[];
};

export type PerformanceBenchmarkGap = {
  readonly id: string;
  readonly name: string;
  /** Quando a série passa a existir; nulo quando nenhum fator foi coletado. */
  readonly available_from: DateOnly | null;
};

/** Quantos dias depois do início da janela o primeiro fator ainda conta como cobertura. */
export const COVERAGE_TOLERANCE_DAYS = 7;

export type PerformanceResult = {
  readonly reference_date: DateOnly | null;
  readonly scope: PerformanceScope;
  readonly method: PerformanceMethod;
  readonly benchmarks: {
    readonly available: readonly PerformanceBenchmark[];
    readonly selected: readonly PerformanceBenchmark[];
    readonly primary_id: string;
    /**
     * Os escolhidos cuja série não cobre o começo do período: falta histórico
     * dela, e a linha curta que sobraria afirmaria um retorno que ninguém mediu.
     */
    readonly gaps: readonly PerformanceBenchmarkGap[];
  };
  readonly chart: PerformanceChart;
  readonly windows: {
    readonly columns: readonly PerformanceWindowColumn[];
    readonly rows: readonly PerformanceWindowRow[];
  };
  readonly breakdown: {
    readonly columns: readonly {
      readonly key: BreakdownKey;
      readonly base_date: DateOnly | null;
    }[];
    readonly classes: readonly PerformanceClassRow[];
    readonly portfolios: readonly PerformancePortfolioRow[];
  };
};

export type PerformanceInput = {
  /** Ausente é Todas as carteiras. */
  readonly portfolio_id?: string | undefined;
  readonly on_date?: DateOnly | undefined;
  readonly from?: DateOnly | undefined;
  readonly to?: DateOnly | undefined;
  /** Vazio ou ausente é o padrão: o benchmark da carteira, ou o CDI sem ele. */
  readonly benchmarks?: readonly string[] | undefined;
};

export type PerformanceDeps = {
  readonly performance: PerformanceRepository;
  readonly clock: Clock;
};

const CHART_DEFAULT_MONTHS = 24;
const BREAKDOWN_KEYS: readonly BreakdownKey[] = ['month', 'ytd', '12m', 'inception'];
const QUOTA_FALLBACK = '1.000000000000';

type Benchmark = PerformanceBenchmark & {
  readonly definition: BenchmarkDefinition;
};

const CDI: Benchmark = {
  id: 'CDI',
  name: 'CDI',
  kind: 'index',
  definition: { kind: 'index', index: 'CDI' },
};

const toBenchmark = (text: string): Benchmark | null => {
  const value = parseBenchmark(text);
  if (value === null) return null;

  return {
    id: formatBenchmark(value),
    name: benchmarkLabel(value),
    kind: value.kind,
    definition: value,
  };
};

const publicBenchmark = (benchmark: Benchmark): PerformanceBenchmark => ({
  id: benchmark.id,
  name: benchmark.name,
  kind: benchmark.kind,
});

/** Os índices sozinhos e o benchmark da carteira: o que a tela oferece sem digitar. */
const availableBenchmarks = (own: Benchmark | null): readonly Benchmark[] => {
  const plain = INDEX_CODES.flatMap((code) => {
    const found = toBenchmark(code);
    return found === null ? [] : [found];
  });

  const all =
    own === null || plain.some((item) => item.id === own.id) ? plain : [own, ...plain];

  return [...all].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
};

/**
 * O que está na tela. A ordem é a das linhas e a das cores, então ela precisa
 * ser estável: o benchmark da carteira primeiro, depois os pedidos na ordem em
 * que vieram — e, sem pedido, o CDI, que é a pergunta que toda carteira
 * brasileira ouve.
 */
const chooseBenchmarks = (
  primary: Benchmark,
  requested: readonly string[],
): readonly Benchmark[] => {
  const asked = requested.flatMap((text) => {
    const found = toBenchmark(text);
    return found === null ? [] : [found];
  });

  const ordered = [primary, ...(asked.length > 0 ? asked : [CDI])];

  return ordered.filter(
    (benchmark, position) =>
      ordered.findIndex((other) => other.id === benchmark.id) === position,
  );
};

const emptyResult = (
  snapshot: PerformanceSnapshot,
  scope: PerformanceScope,
  method: PerformanceMethod,
  catalog: readonly Benchmark[],
  primary: Benchmark,
): PerformanceResult => ({
  reference_date: snapshot.reference_date,
  scope,
  method,
  benchmarks: {
    available: catalog.map(publicBenchmark),
    selected: [],
    primary_id: primary.id,
    gaps: [],
  },
  chart: { base_date: null, dates: [], portfolio: [], benchmarks: [] },
  windows: {
    columns: WINDOWS.map((key) => ({ key, base_date: null })),
    rows: [],
  },
  breakdown: {
    columns: BREAKDOWN_KEYS.map((key) => ({ key, base_date: null })),
    classes: [],
    portfolios: [],
  },
});

/**
 * Com uma carteira, a cota é a gravada. Sem ela, a cota de cada carteira é de
 * cada uma, e a soma delas não tem cota: ela é reconstruída sobre a série somada,
 * com o fluxo líquido entrando ao valor de cota do dia anterior.
 */
const toQuotaDays = (
  days: readonly PerformanceDayRow[],
  consolidated: boolean,
): readonly DecompositionDay[] => {
  const rebuilt = consolidated
    ? buildQuotaSeries(
        days.map((day) => ({
          position_date: day.position_date,
          total_value: day.total_value,
          net_flow: day.net_flow,
          payouts: day.payouts,
        })),
      )
    : [];

  return days.map((day, index) => ({
    position_date: day.position_date,
    total_value: day.total_value,
    net_flow: day.net_flow,
    income: day.income,
    payouts: day.payouts,
    // A coluna é `not null` com cota positiva; o fallback só existe para o
    // tipo, e é o valor inicial da série, não um número inventado.
    quota_value: consolidated
      ? (rebuilt[index]?.quota_value ?? QUOTA_FALLBACK)
      : (day.quota_value ?? QUOTA_FALLBACK),
  }));
};

const pointOf = (day: DecompositionDay): QuotaPoint => ({
  position_date: day.position_date,
  quota_value: day.quota_value,
});

const diff = (portfolio: string | null, benchmark: string | null): string | null =>
  portfolio === null || benchmark === null ? null : differencePp(portfolio, benchmark);

const returnOf = (window: WindowReturn | null): string | null =>
  window === null ? null : window.return_pct;

const classReturns = (
  breakdown: PerformanceBreakdown,
  categoryId: string,
  columns: readonly { readonly key: BreakdownKey; readonly base_date: DateOnly | null }[],
  reference: DateOnly,
): readonly (string | null)[] =>
  columns.map((column) => {
    if (column.base_date === null) return null;

    const value = (label: string): string =>
      breakdown.class_values.find(
        (row) => row.category_id === categoryId && row.label === label,
      )?.value ?? '0.00';

    const inWindow = breakdown.class_flows.filter(
      (row) =>
        row.category_id === categoryId &&
        row.trade_date > column.base_date! &&
        row.trade_date <= reference,
    );

    return modifiedDietz({
      start_date: column.base_date,
      end_date: reference,
      start_value: value(column.key),
      end_value: value('reference'),
      flows: inWindow.map((row) => ({ date: row.trade_date, amount: row.flow })),
      income: sumValues(inWindow.map((row) => row.income)),
    });
  });

export const getPerformance = (deps: PerformanceDeps) =>
  either(async function* (input: PerformanceInput) {
    const onDate = input.on_date ?? deps.clock.today();
    const portfolioId = input.portfolio_id ?? null;
    const consolidated = portfolioId === null;

    const snapshot = yield* await deps.performance.snapshot({
      portfolio_id: portfolioId,
      on_date: onDate,
    });

    const portfolio = snapshot.portfolio;

    if (portfolio === null) {
      return yield* failure(
        new NotFoundError(
          portfolioId === null
            ? 'Nenhuma carteira ativa'
            : `Carteira ${portfolioId} não encontrada`,
        ),
      );
    }

    const scope: PerformanceScope = {
      portfolio_id: portfolioId,
      name: portfolio.name,
      recalc_status: portfolio.recalc_status,
      inception: snapshot.inception,
    };

    const method: PerformanceMethod = {
      portfolio: 'portfolio_quota',
      class: 'modified_dietz',
      benchmark: 'compound_daily_factors',
      annualized: false,
    };

    const own = portfolio.benchmark === null ? null : toBenchmark(portfolio.benchmark);
    const catalog = availableBenchmarks(own);
    const primary = own ?? CDI;

    const reference = snapshot.reference_date;

    if (reference === null || snapshot.days.length === 0) {
      return emptyResult(snapshot, scope, method, catalog, primary);
    }

    // ── A série de cota do escopo ──────────────────────────────────────────
    const quotaDays = toQuotaDays(snapshot.days, consolidated);
    const points = quotaDays.map(pointOf);
    const first = points[0];
    const lastPoint = points[points.length - 1];

    if (first === undefined || lastPoint === undefined) {
      return emptyResult(snapshot, scope, method, catalog, primary);
    }

    // ── As janelas, resolvidas uma vez ─────────────────────────────────────
    const windowResults = new Map<WindowKey, WindowReturn | null>(
      WINDOWS.map((key) => [key, resolveWindow(points, key, reference)]),
    );

    const windowOf = (key: WindowKey): WindowReturn | null =>
      windowResults.get(key) ?? null;

    // ── Os benchmarks escolhidos ───────────────────────────────────────────
    const selected = chooseBenchmarks(primary, input.benchmarks ?? []);

    // ── A segunda consulta: o que depende das datas e dos índices ──────────
    const breakdownPoints: readonly PerformancePoint[] = [
      ...BREAKDOWN_KEYS.map((key): PerformancePoint => ({
        label: key,
        date:
          windowOf(key)?.from.position_date ??
          (key === 'inception' ? first.position_date : null) ??
          (windowStart(reference, key) as string),
      })),
      { label: 'reference', date: lastPoint.position_date },
    ] as readonly PerformancePoint[];

    const breakdown = yield* await deps.performance.breakdown({
      portfolio_id: portfolioId,
      reference: lastPoint.position_date as DateOnly,
      points: breakdownPoints,
      index_codes: [
        ...new Set(selected.flatMap((item) => indexCodesOf(item.definition))),
      ],
      factors_from: first.position_date as DateOnly,
      flows_from: first.position_date as DateOnly,
    });

    const calendar = measurementCalendar(
      breakdown.factors,
      points.map((point) => point.position_date),
    );

    const specs = new Map<string, BenchmarkSpec>(
      selected.map((item) => [
        item.id,
        {
          definition: item.definition,
          factors: breakdown.factors,
          calendar,
        },
      ]),
    );

    const specOf = (benchmark: Benchmark | null): BenchmarkSpec | null =>
      benchmark === null ? null : (specs.get(benchmark.id) ?? null);

    /**
     * Índice sem nenhum fator no período não rendeu zero: ele não foi medido.
     * Sem esta guarda, um CDI ainda não ingerido apareceria como 0,00% e a
     * diferença contra ele como o retorno inteiro da carteira.
     */
    /**
     * Quando a série do benchmark começa dentro de (base, end]. Com mais de um
     * índice, vale o mais tardio: o benchmark só existe onde todos existem.
     */
    const startsAt = (item: Benchmark, base: string, end: string): string | null => {
      let latest: string | null = null;

      for (const code of indexCodesOf(item.definition)) {
        let first: string | null = null;

        for (const date of breakdown.factors.get(code)?.keys() ?? []) {
          if (date > base && date <= end && (first === null || date < first))
            first = date;
        }

        if (first === null) return null;
        if (latest === null || first > latest) latest = first;
      }

      return latest;
    };

    /**
     * Série que só começa no meio do período não cobre o período: a linha
     * parte tarde e o retorno acumulado seria o de uma janela menor.
     */
    const hasCoverage = (item: Benchmark, base: string, end: string): boolean => {
      const start = startsAt(item, base, end);
      return start !== null && start <= addCalendarDays(base, COVERAGE_TOLERANCE_DAYS);
    };

    const gaps: PerformanceBenchmarkGap[] = selected.flatMap((item) => {
      if (hasCoverage(item, first.position_date, lastPoint.position_date)) return [];

      return [
        {
          id: item.id,
          name: item.name,
          available_from: startsAt(
            item,
            first.position_date,
            lastPoint.position_date,
          ) as DateOnly | null,
        },
      ];
    });

    const benchmarkBetween = (
      benchmark: Benchmark | null,
      base: string,
      end: string,
    ): string | null => {
      const spec = specOf(benchmark);
      if (benchmark === null || spec === null || !hasCoverage(benchmark, base, end))
        return null;
      return benchmarkPeriodReturn(spec, base, end);
    };

    // ── O gráfico ──────────────────────────────────────────────────────────
    const chartTo = input.to ?? onDate;
    const chartFrom =
      input.from ?? addCalendarDays(addMonths(chartTo, -CHART_DEFAULT_MONTHS), 1);

    const chart = ((): PerformanceChart => {
      if (chartFrom > chartTo || chartTo < first.position_date) {
        return { base_date: null, dates: [], portfolio: [], benchmarks: [] };
      }

      const before = [...points]
        .reverse()
        .find((point) => point.position_date < chartFrom);
      const base = before ?? first;
      const inPeriod = points.filter(
        (point) =>
          point.position_date > base.position_date && point.position_date <= chartTo,
      );
      const dates = [base.position_date, ...inPeriod.map((point) => point.position_date)];

      return {
        base_date: base.position_date as DateOnly,
        dates: dates as DateOnly[],
        portfolio: ['0.00', ...cumulativeReturns(inPeriod, base)],
        // Benchmark sem fator no recorte fica fora do gráfico: uma linha em
        // zero afirmaria que o índice não rendeu, e ele só não foi medido.
        benchmarks: selected.flatMap((item) => {
          const spec = specs.get(item.id);
          if (spec === undefined || !hasCoverage(item, base.position_date, chartTo))
            return [];

          return [
            {
              id: item.id,
              values: [
                '0.00',
                ...benchmarkCumulative(spec, base.position_date, dates.slice(1)),
              ],
            },
          ];
        }),
      };
    })();

    // ── As janelas ─────────────────────────────────────────────────────────
    const columns: PerformanceWindowColumn[] = WINDOWS.map((key) => ({
      key,
      base_date: (windowOf(key)?.from.position_date ?? null) as DateOnly | null,
    }));

    const portfolioValues = WINDOWS.map((key) => returnOf(windowOf(key)));

    const benchmarkValues = (benchmark: Benchmark): (string | null)[] =>
      WINDOWS.map((key) => {
        const window = windowOf(key);
        return window === null
          ? null
          : benchmarkBetween(
              benchmark,
              window.from.position_date,
              window.to.position_date,
            );
      });

    const windowRows: PerformanceWindowRow[] = [
      { kind: 'portfolio', benchmark: null, name: scope.name, values: portfolioValues },
    ];

    selected.forEach((item, position) => {
      const values = benchmarkValues(item);
      windowRows.push({ kind: 'benchmark', benchmark: item.id, name: item.name, values });

      // A diferença fica logo abaixo do benchmark que a define, como a prancha.
      if (position === 0) {
        windowRows.push({
          kind: 'difference',
          benchmark: null,
          name: 'Diferença',
          values: portfolioValues.map((value, column) =>
            diff(value, values[column] ?? null),
          ),
        });
      }
    });

    // ── Por classe ──────────────────────────────────────────
    const breakdownColumns = BREAKDOWN_KEYS.map((key) => ({
      key,
      base_date: (windowOf(key)?.from.position_date ?? null) as DateOnly | null,
    }));

    const classValue = (categoryId: string): string =>
      breakdown.class_values.find(
        (row) => row.category_id === categoryId && row.label === 'reference',
      )?.value ?? '0.00';

    const classTotal = sumValues(
      breakdown.categories.map((row) => classValue(row.category_id)),
    );

    const classRows: PerformanceClassRow[] = breakdown.categories
      .map((category) => ({
        category_id: category.category_id,
        name: category.name,
        color_token: category.color_token,
        value: classValue(category.category_id),
        weight_pct: weightPct(classValue(category.category_id), classTotal),
        returns: classReturns(
          breakdown,
          category.category_id,
          breakdownColumns,
          lastPoint.position_date as DateOnly,
        ),
      }))
      // Classe vendida inteira continua na tabela enquanto tem retorno a
      // mostrar; a que nunca teve nada nesta história não é linha.
      .filter(
        (row) => Number(row.value) !== 0 || row.returns.some((value) => value !== null),
      )
      .sort((left, right) => Number(right.value) - Number(left.value));

    // ── Por carteira (só em Todas as carteiras) ─────────────────────────────
    const portfolioPoint = (id: string, label: string) =>
      breakdown.portfolio_points.find(
        (point) => point.portfolio_id === id && point.label === label,
      ) ?? null;

    const portfolioRows: PerformancePortfolioRow[] = consolidated
      ? ((): PerformancePortfolioRow[] => {
          const current = breakdown.portfolios.flatMap((row) => {
            const end = portfolioPoint(row.portfolio_id, 'reference');
            return end === null ? [] : [{ row, end }];
          });
          const total = sumValues(current.map((item) => item.end.total_value));

          return current.map(({ row, end }) => ({
            portfolio_id: row.portfolio_id,
            name: row.name,
            value: end.total_value,
            weight_pct: weightPct(end.total_value, total),
            returns: breakdownColumns.map((column) => {
              if (column.base_date === null || end.quota_value === null) return null;

              // Carteira aberta depois da data-base não tem fechamento nela: só
              // "Início" é dela, e parte do primeiro fechamento da própria carteira.
              const base =
                portfolioPoint(row.portfolio_id, column.key) ??
                (column.key === 'inception'
                  ? portfolioPoint(row.portfolio_id, 'first')
                  : null);

              return base === null || base.quota_value === null
                ? null
                : returnPct(base.quota_value, end.quota_value);
            }),
          }));
        })()
      : [];

    return {
      reference_date: reference,
      scope,
      method,
      benchmarks: {
        available: catalog.map(publicBenchmark),
        selected: selected.map(publicBenchmark),
        primary_id: primary.id,
        gaps,
      },
      chart,
      windows: { columns, rows: windowRows },
      breakdown: {
        columns: breakdownColumns,
        classes: classRows,
        portfolios: portfolioRows,
      },
    } satisfies PerformanceResult;
  });
