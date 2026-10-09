import {
  WINDOWS,
  addCalendarDays,
  addMonths,
  benchmarkCumulative,
  benchmarkPeriodReturn,
  buildQuotaSeries,
  cumulativeReturns,
  decomposeByMonth,
  differencePp,
  indexCodesOf,
  measurementCalendar,
  modifiedDietz,
  parseBenchmarkDefinition,
  resolveWindow,
  returnPct,
  sumValues,
  weightPct,
  windowStart,
  yearReturns,
} from '@patrimonio/calc';
import type {
  BenchmarkDefinition,
  BenchmarkSpec,
  DecompositionDay,
  QuotaPoint,
  Rebalance,
  WindowKey,
  WindowReturn,
} from '@patrimonio/calc';
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
 * mercado fez e o que a pessoa depositou. Um mês de aporte grande e mercado
 * caindo parece um mês bom. A cota separa os dois — o aporte entra ao valor de
 * cota do dia anterior, cria cotas e não mexe no preço delas —, e o retorno de
 * qualquer janela é a razão entre duas cotas. É também o que mantém esta rota
 * barata: cada janela sai de duas linhas da série.
 *
 * ## O que muda no consolidado
 *
 * `portfolio_daily.quota_value` é por carteira, e somar cotas de carteiras
 * diferentes não significa nada. Com "todas as carteiras" a cota é **construída**
 * sobre a história inteira do escopo, partindo de 1. A resposta declara qual dos
 * dois métodos usou, e o texto da tela sai dessa declaração.
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
  readonly portfolio_id: string | null;
  readonly name: string;
  readonly purpose: string | null;
  readonly recalc_status: RecalcStatus;
  readonly inception: DateOnly | null;
};

export type PerformanceBenchmark = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'index' | 'index_plus_rate' | 'blend';
};

export type PerformanceMethod = {
  readonly portfolio: 'portfolio_quota' | 'consolidated_quota';
  readonly class: 'modified_dietz';
  readonly benchmark: 'compound_daily_factors';
  readonly annualized: false;
};

export type PerformanceChart = {
  readonly base_date: DateOnly | null;
  readonly dates: readonly DateOnly[];
  readonly portfolio: readonly string[];
  readonly benchmarks: readonly { readonly id: string; readonly values: readonly string[] }[];
};

export type PerformanceWindowColumn = {
  readonly key: WindowKey;
  readonly base_date: DateOnly | null;
};

export type PerformanceWindowRow = {
  readonly kind: 'portfolio' | 'benchmark' | 'difference';
  readonly benchmark_id: string | null;
  readonly name: string;
  readonly values: readonly (string | null)[];
};

export type PerformanceYear = {
  readonly year: number;
  readonly months: readonly (string | null)[];
  readonly total_pct: string | null;
  readonly benchmark_pct: string | null;
  readonly difference_pp: string | null;
  readonly partial: boolean;
};

export type PerformanceDecompositionRow = {
  readonly month: string;
  readonly opening_value: string;
  readonly net_flow: string;
  readonly income: string;
  readonly payouts: string;
  readonly closing_value: string;
  readonly return_pct: string | null;
  readonly benchmark_pct: string | null;
  readonly difference_pp: string | null;
};

export type PerformanceDecompositionTotal = Omit<PerformanceDecompositionRow, 'month'> & {
  readonly months: number;
  readonly from: DateOnly;
  readonly to: DateOnly;
};

export type BreakdownKey = 'month' | 'ytd' | '12m' | 'inception';

export type PerformancePortfolioRow = {
  readonly portfolio_id: string;
  readonly name: string;
  readonly value: string | null;
  readonly weight_pct: string | null;
  readonly selected: boolean;
  readonly returns: readonly (string | null)[];
};

export type PerformanceClassRow = {
  readonly category_id: string;
  readonly name: string;
  readonly color_token: string;
  readonly value: string;
  readonly weight_pct: string;
  readonly is_cash: boolean;
  readonly returns: readonly (string | null)[];
};

export type PerformanceResult = {
  readonly reference_date: DateOnly | null;
  readonly scope: PerformanceScope;
  readonly method: PerformanceMethod;
  readonly benchmarks: {
    readonly available: readonly PerformanceBenchmark[];
    readonly selected: readonly PerformanceBenchmark[];
    readonly primary_id: string | null;
  };
  readonly chart: PerformanceChart;
  readonly windows: {
    readonly columns: readonly PerformanceWindowColumn[];
    readonly rows: readonly PerformanceWindowRow[];
  };
  readonly monthly: {
    readonly benchmark_name: string | null;
    readonly years: readonly PerformanceYear[];
  };
  readonly decomposition: {
    readonly benchmark_name: string | null;
    readonly rows: readonly PerformanceDecompositionRow[];
    readonly total: PerformanceDecompositionTotal | null;
  };
  readonly breakdown: {
    readonly columns: readonly { readonly key: BreakdownKey; readonly base_date: DateOnly | null }[];
    readonly portfolios: readonly PerformancePortfolioRow[];
    readonly classes: readonly PerformanceClassRow[];
  };
};

export type PerformanceInput = {
  readonly portfolio_id?: string | null | undefined;
  readonly on_date?: DateOnly | undefined;
  readonly from?: DateOnly | undefined;
  readonly to?: DateOnly | undefined;
  /** Vazio ou ausente é o padrão: o benchmark da carteira e o CDI. */
  readonly benchmark_ids?: readonly string[] | undefined;
};

export type PerformanceDeps = {
  readonly performance: PerformanceRepository;
  readonly clock: Clock;
};

const ALL_PORTFOLIOS_NAME = 'Todas as carteiras';
const CHART_DEFAULT_MONTHS = 24;
const DECOMPOSITION_MONTHS = 12;
const BREAKDOWN_KEYS: readonly BreakdownKey[] = ['month', 'ytd', '12m', 'inception'];
const QUOTA_FALLBACK = '1.000000000000';

type Benchmark = PerformanceBenchmark & {
  readonly definition: BenchmarkDefinition;
  readonly rebalance: Rebalance;
};

const REBALANCE_VALUES: readonly string[] = ['daily', 'monthly', 'never'];

const parseBenchmarks = (snapshot: PerformanceSnapshot): readonly Benchmark[] =>
  snapshot.benchmarks
    .flatMap((row): Benchmark[] => {
      const definition = parseBenchmarkDefinition(row.kind, row.definition);
      if (definition === null) return [];

      return [
        {
          id: row.id,
          name: row.name,
          kind: definition.kind,
          definition,
          rebalance: (REBALANCE_VALUES.includes(row.rebalance)
            ? row.rebalance
            : 'never') as Rebalance,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));

const publicBenchmark = (benchmark: Benchmark): PerformanceBenchmark => ({
  id: benchmark.id,
  name: benchmark.name,
  kind: benchmark.kind,
});

/**
 * O que está na tela. A ordem é a das linhas e a das cores, então ela precisa
 * ser estável: o benchmark da carteira primeiro, depois os pedidos na ordem em
 * que vieram — e, sem pedido, o CDI, que é a pergunta que toda carteira
 * brasileira ouve.
 */
const chooseBenchmarks = (
  catalog: readonly Benchmark[],
  requested: readonly string[],
  primaryId: string | null,
): readonly Benchmark[] => {
  const byId = new Map(catalog.map((benchmark) => [benchmark.id, benchmark]));
  const primary = primaryId === null ? undefined : byId.get(primaryId);

  const asked = requested.flatMap((id) => {
    const found = byId.get(id);
    return found === undefined ? [] : [found];
  });

  const fallback =
    asked.length > 0
      ? asked
      : catalog.filter(
          (benchmark) =>
            benchmark.definition.kind === 'index' && benchmark.definition.index === 'CDI',
        );

  const ordered = primary === undefined ? fallback : [primary, ...fallback];

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
): PerformanceResult => ({
  reference_date: snapshot.reference_date,
  scope,
  method,
  benchmarks: { available: catalog.map(publicBenchmark), selected: [], primary_id: null },
  chart: { base_date: null, dates: [], portfolio: [], benchmarks: [] },
  windows: {
    columns: WINDOWS.map((key) => ({ key, base_date: null })),
    rows: [],
  },
  monthly: { benchmark_name: null, years: [] },
  decomposition: { benchmark_name: null, rows: [], total: null },
  breakdown: {
    columns: BREAKDOWN_KEYS.map((key) => ({ key, base_date: null })),
    portfolios: [],
    classes: [],
  },
});

const toQuotaDays = (
  days: readonly PerformanceDayRow[],
  scoped: boolean,
): readonly DecompositionDay[] => {
  if (!scoped) {
    return buildQuotaSeries(
      days.map((day) => ({
        position_date: day.position_date,
        total_value: day.total_value,
        net_flow: day.net_flow,
        payouts: day.payouts,
      })),
    );
  }

  return days.map((day) => ({
    position_date: day.position_date,
    total_value: day.total_value,
    net_flow: day.net_flow,
    income: day.income,
    payouts: day.payouts,
    // A coluna é `not null` com cota positiva; o fallback só existe para o
    // tipo, e é o valor inicial da série, não um número inventado.
    quota_value: day.quota_value ?? QUOTA_FALLBACK,
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

/** O retorno entre dois pontos de cota de uma carteira; nulo sem as duas pontas. */
const portfolioReturn = (
  base: { readonly position_date: string | null; readonly quota_value: string | null } | undefined,
  end: { readonly position_date: string | null; readonly quota_value: string | null } | undefined,
): string | null => {
  if (base === undefined || end === undefined) return null;
  if (base.position_date === null || base.quota_value === null) return null;
  if (end.position_date === null || end.quota_value === null) return null;
  // Uma só data não é um período: é o mesmo critério de `resolveWindow`.
  if (base.position_date === end.position_date) return null;

  return returnPct(base.quota_value, end.quota_value);
};

const classReturns = (
  breakdown: PerformanceBreakdown,
  categoryId: string,
  isCash: boolean,
  columns: readonly { readonly key: BreakdownKey; readonly base_date: DateOnly | null }[],
  reference: DateOnly,
): readonly (string | null)[] =>
  columns.map((column) => {
    // O caixa não rende por si: o saldo dele só muda pelo que entra e sai.
    if (isCash || column.base_date === null) return null;

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

    const snapshot = yield* await deps.performance.snapshot({
      portfolio_id: portfolioId,
      on_date: onDate,
    });

    const portfolio =
      portfolioId === null
        ? null
        : (snapshot.portfolios.find((row) => row.portfolio_id === portfolioId) ?? null);

    if (portfolioId !== null && portfolio === null) {
      return yield* failure(new NotFoundError(`Carteira ${portfolioId} não encontrada`));
    }

    const scope: PerformanceScope =
      portfolio === null
        ? {
            portfolio_id: null,
            name: ALL_PORTFOLIOS_NAME,
            purpose: null,
            recalc_status: snapshot.portfolios.some(
              (row) => row.recalc_status === 'running' || row.recalc_status === 'queued',
            )
              ? 'running'
              : 'idle',
            inception: snapshot.inception,
          }
        : {
            portfolio_id: portfolioId,
            name: portfolio.name,
            purpose: portfolio.purpose,
            recalc_status: portfolio.recalc_status,
            inception: snapshot.inception,
          };

    const method: PerformanceMethod = {
      portfolio: portfolioId === null ? 'consolidated_quota' : 'portfolio_quota',
      class: 'modified_dietz',
      benchmark: 'compound_daily_factors',
      annualized: false,
    };

    const catalog = parseBenchmarks(snapshot);
    const reference = snapshot.reference_date;

    if (reference === null || snapshot.days.length === 0) {
      return emptyResult(snapshot, scope, method, catalog);
    }

    // ── A série de cota do escopo ──────────────────────────────────────────
    const quotaDays = toQuotaDays(snapshot.days, portfolioId !== null);
    const points = quotaDays.map(pointOf);
    const first = points[0];
    const lastPoint = points[points.length - 1];

    if (first === undefined || lastPoint === undefined) {
      return emptyResult(snapshot, scope, method, catalog);
    }

    // ── As janelas, resolvidas uma vez ─────────────────────────────────────
    const windowResults = new Map<WindowKey, WindowReturn | null>(
      WINDOWS.map((key) => [key, resolveWindow(points, key, reference)]),
    );

    const windowOf = (key: WindowKey): WindowReturn | null => windowResults.get(key) ?? null;

    // ── Os benchmarks escolhidos ───────────────────────────────────────────
    const selected = chooseBenchmarks(
      catalog,
      input.benchmark_ids ?? [],
      portfolio?.benchmark_id ?? null,
    );
    const referenceBenchmark = selected[0] ?? null;

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
      index_codes: [...new Set(selected.flatMap((item) => indexCodesOf(item.definition)))],
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
          rebalance: item.rebalance,
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
    const hasCoverage = (item: Benchmark, base: string, end: string): boolean =>
      indexCodesOf(item.definition).some((code) => {
        for (const date of breakdown.factors.get(code)?.keys() ?? []) {
          if (date > base && date <= end) return true;
        }
        return false;
      });

    const benchmarkBetween = (
      benchmark: Benchmark | null,
      base: string,
      end: string,
    ): string | null => {
      const spec = specOf(benchmark);
      if (benchmark === null || spec === null || !hasCoverage(benchmark, base, end)) return null;
      return benchmarkPeriodReturn(spec, base, end);
    };

    // ── O gráfico ──────────────────────────────────────────────────────────
    const chartTo = input.to ?? onDate;
    const chartFrom =
      input.from ??
      addCalendarDays(addMonths(chartTo, -CHART_DEFAULT_MONTHS), 1);

    const chart = ((): PerformanceChart => {
      if (chartFrom > chartTo || chartTo < first.position_date) {
        return { base_date: null, dates: [], portfolio: [], benchmarks: [] };
      }

      const before = [...points].reverse().find((point) => point.position_date < chartFrom);
      const base = before ?? first;
      const inPeriod = points.filter(
        (point) => point.position_date > base.position_date && point.position_date <= chartTo,
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
          if (spec === undefined || !hasCoverage(item, base.position_date, chartTo)) return [];

          return [
            {
              id: item.id,
              values: ['0.00', ...benchmarkCumulative(spec, base.position_date, dates.slice(1))],
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
          : benchmarkBetween(benchmark, window.from.position_date, window.to.position_date);
      });

    const windowRows: PerformanceWindowRow[] = [
      { kind: 'portfolio', benchmark_id: null, name: scope.name, values: portfolioValues },
    ];

    selected.forEach((item, position) => {
      const values = benchmarkValues(item);
      windowRows.push({ kind: 'benchmark', benchmark_id: item.id, name: item.name, values });

      // A diferença fica logo abaixo do benchmark que a define, como a prancha.
      if (position === 0) {
        windowRows.push({
          kind: 'difference',
          benchmark_id: null,
          name: 'Diferença',
          values: portfolioValues.map((value, column) => diff(value, values[column] ?? null)),
        });
      }
    });

    // ── A grade mês por ano ────────────────────────────────────────────────
    const months = decomposeByMonth(quotaDays);
    const yearTotals = new Map(yearReturns(points).map((year) => [year.year, year]));
    const referenceYear = Number(reference.slice(0, 4));

    const years = new Map<number, (string | null)[]>();
    for (const month of months) {
      const row = years.get(month.year) ?? Array.from({ length: 12 }, () => null);
      row[month.month_number - 1] = month.return_pct;
      years.set(month.year, row);
    }

    const yearRows: PerformanceYear[] = [...years.entries()]
      .sort(([left], [right]) => right - left)
      .map(([year, values]) => {
        const total = yearTotals.get(year);
        const benchmark =
          total === undefined
            ? null
            : benchmarkBetween(referenceBenchmark, total.base_date, total.end_date);

        return {
          year,
          months: values,
          total_pct: total?.return_pct ?? null,
          benchmark_pct: benchmark,
          difference_pp: diff(total?.return_pct ?? null, benchmark),
          partial: year === referenceYear,
        };
      });

    // ── A decomposição dos últimos doze meses ─────────────────────────────
    const lastCloseOf = new Map<string, QuotaPoint>();
    for (const point of points) lastCloseOf.set(point.position_date.slice(0, 7), point);

    const quotaAt = new Map(points.map((point) => [point.position_date, point.quota_value]));

    const baseDateOf = (index: number): string => {
      const previous = months[index - 1];
      return previous === undefined
        ? first.position_date
        : (lastCloseOf.get(previous.month)?.position_date ?? first.position_date);
    };

    const recent = months.slice(-DECOMPOSITION_MONTHS);
    const offset = months.length - recent.length;

    const decompositionRows: PerformanceDecompositionRow[] = recent
      .map((month, position) => {
        const base = baseDateOf(offset + position);
        const end = lastCloseOf.get(month.month)?.position_date ?? base;
        const benchmark = benchmarkBetween(referenceBenchmark, base, end);

        return {
          month: month.month,
          opening_value: month.opening_value,
          net_flow: month.net_flow,
          income: month.income,
          payouts: month.payouts,
          closing_value: month.closing_value,
          return_pct: month.return_pct,
          benchmark_pct: benchmark,
          difference_pp: diff(month.return_pct, benchmark),
        };
      })
      .reverse();

    const decompositionTotal = ((): PerformanceDecompositionTotal | null => {
      const oldest = recent[0];
      const newest = recent[recent.length - 1];
      if (oldest === undefined || newest === undefined) return null;

      const from = baseDateOf(offset);
      const to = lastCloseOf.get(newest.month)?.position_date ?? lastPoint.position_date;
      const fromQuota = quotaAt.get(from);
      const toQuota = quotaAt.get(to);
      const total =
        fromQuota === undefined || toQuota === undefined ? null : returnPct(fromQuota, toQuota);
      const benchmark = benchmarkBetween(referenceBenchmark, from, to);

      return {
        months: recent.length,
        from: from as DateOnly,
        to: to as DateOnly,
        opening_value: oldest.opening_value,
        net_flow: sumValues(recent.map((month) => month.net_flow)),
        income: sumValues(recent.map((month) => month.income)),
        payouts: sumValues(recent.map((month) => month.payouts)),
        closing_value: newest.closing_value,
        return_pct: total,
        benchmark_pct: benchmark,
        difference_pp: diff(total, benchmark),
      };
    })();

    // ── Por carteira e por classe ──────────────────────────────────────────
    const breakdownColumns = BREAKDOWN_KEYS.map((key) => ({
      key,
      base_date: (windowOf(key)?.from.position_date ?? null) as DateOnly | null,
    }));

    const portfolioTotal = sumValues(snapshot.portfolios.map((row) => row.total_value ?? '0'));

    const pointOfPortfolio = (id: string, label: string) =>
      breakdown.portfolio_points.find(
        (row) => row.portfolio_id === id && row.label === label,
      );

    const portfolioRows: PerformancePortfolioRow[] = snapshot.portfolios.map((row) => ({
      portfolio_id: row.portfolio_id,
      name: row.name,
      value: row.total_value,
      weight_pct:
        row.total_value === null ? null : weightPct(row.total_value, portfolioTotal),
      selected: row.portfolio_id === portfolioId,
      returns: BREAKDOWN_KEYS.map((key) =>
        portfolioReturn(
          pointOfPortfolio(row.portfolio_id, key),
          pointOfPortfolio(row.portfolio_id, 'reference'),
        ),
      ),
    }));

    const classValue = (categoryId: string): string =>
      breakdown.class_values.find(
        (row) => row.category_id === categoryId && row.label === 'reference',
      )?.value ?? '0.00';

    const classTotal = sumValues(breakdown.categories.map((row) => classValue(row.category_id)));

    const classRows: PerformanceClassRow[] = breakdown.categories
      .map((category) => ({
        category_id: category.category_id,
        name: category.name,
        color_token: category.color_token,
        value: classValue(category.category_id),
        weight_pct: weightPct(classValue(category.category_id), classTotal),
        is_cash: category.is_cash,
        returns: classReturns(
          breakdown,
          category.category_id,
          category.is_cash,
          breakdownColumns,
          lastPoint.position_date as DateOnly,
        ),
      }))
      // Classe vendida inteira continua na tabela enquanto tem retorno a
      // mostrar; a que nunca teve nada nesta história não é linha.
      .filter((row) => Number(row.value) !== 0 || row.returns.some((value) => value !== null))
      .sort((left, right) => Number(right.value) - Number(left.value));

    return {
      reference_date: reference,
      scope,
      method,
      benchmarks: {
        available: catalog.map(publicBenchmark),
        selected: selected.map(publicBenchmark),
        primary_id: referenceBenchmark?.id ?? null,
      },
      chart,
      windows: { columns, rows: windowRows },
      monthly: { benchmark_name: referenceBenchmark?.name ?? null, years: yearRows },
      decomposition: {
        benchmark_name: referenceBenchmark?.name ?? null,
        rows: decompositionRows,
        total: decompositionTotal,
      },
      breakdown: {
        columns: breakdownColumns,
        portfolios: portfolioRows,
        classes: classRows,
      },
    } satisfies PerformanceResult;
  });
