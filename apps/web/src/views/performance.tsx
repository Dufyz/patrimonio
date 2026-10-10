import type {
  PerformanceBreakdownResource,
  PerformanceDecompositionResource,
  PerformanceResource,
  PerformanceWindowsResource,
} from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchPerformance } from '../api/performance.js';
import { MonthYearGrid } from '../components/month_year_grid.js';
import { Money, Percent, Points } from '../components/number.js';
import { KeepPrevious } from '../components/pending.js';
import { PeriodControl } from '../components/period_control.js';
import { usePreferences } from '../components/preferences.js';
import { Button, Chip, IconButton, Label, Panel } from '../components/primitives.js';
import { SeriesChart } from '../components/series_chart.js';
import { useDismiss } from '../components/use_dismiss.js';
import {
  CSV_BOM,
  PORTFOLIO_COLOR,
  addBenchmark,
  availableToAdd,
  benchmarkColor,
  chartSeries,
  csvFilename,
  decompositionCsv,
  extraBenchmarks,
  gridYears,
  methodLines,
  removeBenchmark,
  shortMonth,
  windowLabel,
} from '../lib/performance.js';
import { formatDate, monthTicks, percentAsRatio } from '../lib/overview.js';
import type { Period } from '../lib/period.js';
import {
  encodePeriod,
  formatDayMonth,
  decodePeriod,
  isPeriodPreset,
  resolvePeriod,
} from '../lib/period.js';
import { colorForToken } from '../lib/tokens.js';
import { listParam, readParams, writeParams } from '../lib/url_state.js';
import type { Resource } from '../lib/use_resource.js';
import { useResource } from '../lib/use_resource.js';

/**
 * T-05 · Desempenho — a prancha `08 · Desempenho`.
 *
 * A tela responde a pergunta que motivou o produto: **quanto do crescimento
 * veio de aporte e quanto veio de rentabilidade**. Ela a responde em quatro
 * resoluções — a carteira contra o mercado ao longo do tempo, mês a mês, o
 * saldo decomposto e a quebra por carteira e por classe — e declara no rodapé
 * como cada número foi calculado, porque "retorno" sem método é opinião.
 *
 * Nada aqui faz conta. Retorno, diferença em pontos e decomposição chegam
 * prontos; a tela escolhe cor, casa decimal e ordem.
 */

/** O padrão desta tela é 24 meses; os demais usam 12, e cada um escreve o seu. */
export const PERFORMANCE_DEFAULT_PERIOD: Period = { kind: 'preset', preset: '24m' };

const decodePerformancePeriod = (raw: string | null): Period =>
  raw === null || (!isPeriodPreset(raw) && !raw.includes('..'))
    ? PERFORMANCE_DEFAULT_PERIOD
    : decodePeriod(raw);

const CODECS = { benchmarks: listParam('benchmarks') } as const;

export type PerformanceViewProps = {
  readonly resource: Resource<PerformanceResource>;
  readonly period: Period;
  readonly onPeriodChange: (period: Period) => void;
  readonly today: DateOnly;
  /** Os benchmarks pedidos além do da carteira, que a URL guarda. */
  readonly extraIds: readonly string[];
  readonly onExtraIdsChange: (ids: readonly string[]) => void;
};

export type PerformanceScreenProps = {
  readonly portfolioId: string;
};

const todayIso = (): DateOnly => new Date().toISOString().slice(0, 10) as DateOnly;

/**
 * A tela como a rota a monta: período e benchmarks na query, escopo vindo do
 * endereço, tudo num pedido só. O padrão nunca é escrito na URL.
 */
export const PerformanceScreen = ({
  portfolioId,
}: PerformanceScreenProps): React.ReactElement => {
  const [params, setParams] = useSearchParams();
  const today = todayIso();

  const period = decodePerformancePeriod(params.get('periodo'));
  const { benchmarks: extraIds } = readParams(params, CODECS);

  const onPeriodChange = useCallback(
    (next: Period) => {
      setParams(
        (current) => {
          const search = new URLSearchParams(current);
          const encoded = encodePeriod(next);
          if (encoded === encodePeriod(PERFORMANCE_DEFAULT_PERIOD))
            search.delete('periodo');
          else search.set('periodo', encoded);
          return search;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const onExtraIdsChange = useCallback(
    (ids: readonly string[]) =>
      setParams((current) => writeParams(current, CODECS, { benchmarks: ids }), {
        replace: true,
      }),
    [setParams],
  );

  const [inception, setInception] = useState<DateOnly | null>(null);
  const range = resolvePeriod(period, today, inception);

  const resource = useResource(
    (signal) =>
      fetchPerformance(
        { portfolioId, from: range.from, to: range.to, benchmarkIds: extraIds },
        signal,
      ),
    [portfolioId, range.from, range.to, extraIds.join(',')],
  );

  useEffect(() => {
    if (resource.state.kind === 'ready') {
      setInception(resource.state.value.scope.inception as DateOnly | null);
    }
  }, [resource.state]);

  return (
    <PerformanceView
      resource={resource}
      period={period}
      onPeriodChange={onPeriodChange}
      today={today}
      extraIds={extraIds}
      onExtraIdsChange={onExtraIdsChange}
    />
  );
};

/* -------------------------------------------------------------------------- */
/* Retorno acumulado × benchmarks                                              */

const BenchmarkPicker = ({
  options,
  onPick,
}: {
  readonly options: readonly { readonly id: string; readonly name: string }[];
  readonly onPick: (id: string) => void;
}): React.ReactElement | null => {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useDismiss(container, open, () => setOpen(false));

  if (options.length === 0) return null;

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-control cursor-pointer items-center gap-2 rounded-full border border-dashed border-line-strong px-3 text-[0.8125rem] text-ink-2 hover:bg-panel-2"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">+</span> Benchmark
      </button>
      {open ? (
        <ul
          role="menu"
          className="absolute top-full left-0 z-20 mt-1 min-w-48 rounded-panel border border-line bg-panel p-1 shadow-lg"
        >
          {options.map((option) => (
            <li key={option.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="w-full cursor-pointer rounded-control px-3 py-1.5 text-left text-[0.8125rem] hover:bg-panel-2"
                onClick={() => {
                  onPick(option.id);
                  setOpen(false);
                }}
              >
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const LineSwatch = ({
  color,
  dashed = false,
}: {
  readonly color: string;
  readonly dashed?: boolean;
}): React.ReactElement => (
  <span
    aria-hidden="true"
    className="inline-block h-0 w-4 shrink-0 border-t-2"
    style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
  />
);

const WindowsTable = ({
  windows,
  referenceDate,
  inception,
}: {
  readonly windows: PerformanceWindowsResource;
  readonly referenceDate: string | null;
  readonly inception: string | null;
}): React.ReactElement => {
  let benchmarkPosition = -1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-160 border-collapse text-[0.8125rem]">
        <caption className="sr-only">Retorno por janela</caption>
        <thead>
          <tr className="border-y border-line bg-panel-2 text-label tracking-wide text-ink-3 uppercase">
            <th scope="col" className="px-4 py-2 text-left font-medium">
              Janela
            </th>
            {windows.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="px-4 py-2 text-right font-medium"
              >
                {windowLabel(column.key, { referenceDate, inception })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {windows.rows.map((row) => {
            if (row.kind === 'benchmark') benchmarkPosition += 1;

            return (
              <tr
                key={`${row.kind}:${row.benchmark_id ?? ''}`}
                className="h-(--row-height) border-b border-line"
              >
                <th scope="row" className="px-4 text-left font-normal">
                  <span className="flex items-center gap-2">
                    {row.kind === 'portfolio' ? (
                      <LineSwatch color={PORTFOLIO_COLOR} />
                    ) : row.kind === 'benchmark' ? (
                      <LineSwatch
                        color={benchmarkColor(benchmarkPosition)}
                        dashed={benchmarkPosition === 0}
                      />
                    ) : (
                      <span className="w-4" />
                    )}
                    <span
                      className={
                        row.kind === 'portfolio' ? 'font-semibold' : 'text-ink-2'
                      }
                    >
                      {row.name}
                    </span>
                  </span>
                </th>
                {row.values.map((value, index) => (
                  <td
                    key={windows.columns[index]?.key ?? index}
                    className="px-4 text-right"
                  >
                    {row.kind === 'difference' ? (
                      <Points value={value} decimals={2} />
                    ) : (
                      <Percent
                        value={percentAsRatio(value)}
                        decimals={2}
                        signed={row.kind === 'portfolio'}
                        tone={row.kind === 'portfolio' ? 'signed' : 'neutral'}
                      />
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const Accumulated = ({
  data,
  period,
  today,
  extraIds,
  onExtraIdsChange,
}: {
  readonly data: PerformanceResource;
  readonly period: Period;
  readonly today: DateOnly;
  readonly extraIds: readonly string[];
  readonly onExtraIdsChange: (ids: readonly string[]) => void;
}): React.ReactElement => {
  const { benchmarks, chart, scope } = data;
  const primary = benchmarks.selected.find((item) => item.id === benchmarks.primary_id);
  const extras = extraBenchmarks(benchmarks.selected, benchmarks.primary_id);
  const range = resolvePeriod(period, today, scope.inception as DateOnly | null);
  const ticks = monthTicks(chart.dates as DateOnly[]);

  const missing = benchmarks.selected.filter(
    (item) => !chart.benchmarks.some((line) => line.id === item.id),
  );

  return (
    <Panel
      title="Retorno acumulado × benchmarks da carteira"
      hint={`${formatDayMonth(range.from, today)} – ${formatDayMonth(range.to, today)} · base 0%`}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Chip selected>
          <LineSwatch color={PORTFOLIO_COLOR} />
          {scope.name}
        </Chip>
        {primary === undefined ? null : (
          <span className="text-[0.75rem] text-ink-3">
            benchmark principal: {primary.name}
          </span>
        )}
        {extras.map((item) => (
          <Chip
            key={item.id}
            onRemove={() => onExtraIdsChange(removeBenchmark(extraIds, item.id))}
          >
            <LineSwatch
              color={benchmarkColor(
                benchmarks.selected.findIndex((one) => one.id === item.id),
              )}
            />
            {item.name}
          </Chip>
        ))}
        <BenchmarkPicker
          options={availableToAdd(benchmarks)}
          onPick={(id) => onExtraIdsChange(addBenchmark(extraIds, id))}
        />
      </div>

      <div className="px-4 pb-3">
        {chart.dates.length === 0 ? (
          <p className="flex min-h-40 items-center justify-center text-[0.8125rem] text-ink-3">
            Sem fechamento no período escolhido.
          </p>
        ) : (
          <SeriesChart
            dates={chart.dates as DateOnly[]}
            series={chartSeries(chart, benchmarks.selected, scope.name)}
            valueFormat="percent"
            ariaLabel="Retorno acumulado da carteira contra os benchmarks"
            xTickLabel={(date) => ticks.get(date) ?? ''}
            tooltipDateLabel={(date) => formatDate(date)}
            height={280}
          />
        )}
        {missing.length === 0 ? null : (
          <p className="mt-2 text-[0.75rem] text-attention">
            Sem dado de índice no período: {missing.map((item) => item.name).join(', ')}.
            Eles aparecem como traço, e não como zero.
          </p>
        )}
      </div>

      <WindowsTable
        windows={data.windows}
        referenceDate={data.reference_date}
        inception={scope.inception}
      />
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* Retornos mensais                                                            */

const Monthly = ({
  data,
}: {
  readonly data: PerformanceResource;
}): React.ReactElement => {
  const { monthly } = data;
  const reference = monthly.benchmark_name;

  return (
    <Panel
      title="Retornos mensais"
      hint={`Rentabilidade da cota da carteira${
        reference === null ? '' : ` · última coluna compara com ${reference} no ano`
      }`}
    >
      <div className="p-4">
        {monthly.years.length === 0 ? (
          <p className="text-[0.8125rem] text-ink-3">
            Nenhum mês fechado ainda: o primeiro retorno mensal chega no segundo
            fechamento.
          </p>
        ) : (
          <MonthYearGrid
            years={gridYears(monthly)}
            format="percent"
            totalHeader="Ano"
            extraHeaders={reference === null ? [] : [reference, 'Diferença']}
            extraKinds={['format', 'points']}
            caption="Retorno mensal da carteira por ano"
          />
        )}
      </div>
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* De onde veio cada mês                                                       */

const Decomposition = ({
  decomposition,
  onExport,
}: {
  readonly decomposition: PerformanceDecompositionResource;
  readonly onExport: () => void;
}): React.ReactElement => {
  const bench = decomposition.benchmark_name;
  const total = decomposition.total;

  const head = (label: string, align: 'left' | 'right' = 'right'): React.ReactElement => (
    <th
      scope="col"
      className={`px-4 py-2 font-medium ${align === 'left' ? 'text-left' : 'text-right'}`}
    >
      {label}
    </th>
  );

  const cells = (
    row: PerformanceDecompositionResource['rows'][number] | NonNullable<typeof total>,
    strong: boolean,
  ): React.ReactElement => (
    <>
      <td className="px-4 text-right">
        <Money value={row.opening_value} bare />
      </td>
      <td className="px-4 text-right">
        <Money value={row.net_flow} bare />
      </td>
      <td className="px-4 text-right">
        <Money value={row.income} bare tone="signed" />
      </td>
      <td className="px-4 text-right text-ink-2">
        <Money value={row.payouts} bare />
      </td>
      <td className={`px-4 text-right ${strong ? 'font-semibold' : ''}`}>
        <Money value={row.closing_value} bare />
      </td>
      <td className="px-4 text-right">
        <Percent
          value={percentAsRatio(row.return_pct)}
          decimals={2}
          signed
          tone="signed"
        />
      </td>
      <td className="px-4 text-right text-ink-2">
        <Percent value={percentAsRatio(row.benchmark_pct)} decimals={2} />
      </td>
      <td className="px-4 text-right">
        <Points value={row.difference_pp} decimals={2} />
      </td>
    </>
  );

  return (
    <Panel
      title="De onde veio cada mês"
      hint="Saldo da carteira decomposto em aportes e rendimento · últimos 12 meses"
      action={
        <Button onClick={onExport} disabled={decomposition.rows.length === 0}>
          Exportar CSV
        </Button>
      }
    >
      {decomposition.rows.length === 0 ? (
        <p className="p-4 text-[0.8125rem] text-ink-3">Nenhum mês fechado no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 border-collapse text-[0.8125rem]">
            <caption className="sr-only">Decomposição mensal do saldo</caption>
            <thead>
              <tr className="border-b border-line bg-panel-2 text-label tracking-wide text-ink-3 uppercase">
                {head('Mês', 'left')}
                {head('Saldo inicial')}
                {head('Aportes − resgates')}
                {head('Rendimento')}
                {head('Dos quais proventos')}
                {head('Saldo final')}
                {head('Rent.')}
                {head(bench ?? 'Benchmark')}
                {head('Diferença')}
              </tr>
            </thead>
            <tbody>
              {decomposition.rows.map((row) => (
                <tr key={row.month} className="h-(--row-height) border-b border-line">
                  <th scope="row" className="px-4 text-left font-normal">
                    {shortMonth(row.month)}
                  </th>
                  {cells(row, true)}
                </tr>
              ))}
            </tbody>
            {total === null ? null : (
              <tfoot>
                <tr className="h-(--row-height) font-semibold">
                  <th scope="row" className="px-4 text-left">
                    {total.months} meses
                  </th>
                  {cells(total, true)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* Por carteira e por classe                                                   */

const ReturnHeads = ({
  columns,
  referenceDate,
  inception,
}: {
  readonly columns: PerformanceBreakdownResource['columns'];
  readonly referenceDate: string | null;
  readonly inception: string | null;
}): React.ReactElement => (
  <>
    {columns.map((column) => (
      <th key={column.key} scope="col" className="px-4 py-2 text-right font-medium">
        {windowLabel(column.key, { referenceDate, inception })}
      </th>
    ))}
  </>
);

const Breakdown = ({
  data,
}: {
  readonly data: PerformanceResource;
}): React.ReactElement => {
  const { breakdown } = data;

  return (
    <div className="grid grid-cols-1 gap-4">
      <Panel
        title="Por classe de ativo"
        hint="Dietz modificado · aproximação, a classe não tem cota"
      >
        {breakdown.classes.length === 0 ? (
          <p className="p-4 text-[0.8125rem] text-ink-3">Nenhuma posição em carteira.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-120 border-collapse text-[0.8125rem]">
              <caption className="sr-only">Retorno por classe de ativo</caption>
              <thead>
                <tr className="border-b border-line bg-panel-2 text-label tracking-wide text-ink-3 uppercase">
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Classe
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Valor
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Peso
                  </th>
                  <ReturnHeads
                    columns={breakdown.columns}
                    referenceDate={data.reference_date}
                    inception={data.scope.inception}
                  />
                </tr>
              </thead>
              <tbody>
                {breakdown.classes.map((row) => (
                  <tr
                    key={row.category_id}
                    className="h-(--row-height) border-b border-line"
                  >
                    <th scope="row" className="px-4 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-xs"
                          style={{ backgroundColor: colorForToken(row.color_token) }}
                        />
                        {row.name}
                      </span>
                    </th>
                    <td className="px-4 text-right">
                      <Money value={row.value} bare />
                    </td>
                    <td className="px-4 text-right text-ink-2">
                      <Percent value={percentAsRatio(row.weight_pct)} decimals={1} />
                    </td>
                    {row.returns.map((value, index) => (
                      <td
                        key={breakdown.columns[index]?.key ?? index}
                        className="px-4 text-right"
                        title={row.is_cash ? 'Caixa não rende por si' : undefined}
                      >
                        <Percent
                          value={row.is_cash ? null : percentAsRatio(value)}
                          decimals={2}
                          signed
                          tone="signed"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* A moldura                                                                   */

const Method = ({ data }: { readonly data: PerformanceResource }): React.ReactElement => (
  <Panel title="Como estes números são calculados">
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 p-4 text-[0.8125rem] md:grid-cols-[8rem_1fr]">
      {methodLines(data.method).map((line) => (
        <div key={line.label} className="contents">
          <dt>
            <Label>{line.label}</Label>
          </dt>
          <dd className="text-ink-2">{line.text}</dd>
        </div>
      ))}
    </dl>
  </Panel>
);

const Empty = ({ scope }: { readonly scope: string }): React.ReactElement => (
  <section className="rounded-panel border border-line bg-panel p-8 text-center">
    <h2 className="text-panel-title font-semibold">Nenhum fechamento ainda</h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {scope} não tem história para medir. O desempenho começa no primeiro fechamento e
      ganha a primeira janela no segundo.
    </p>
  </section>
);

const Failed = ({
  error,
  onRetry,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
}): React.ReactElement => (
  <section
    role="alert"
    className="rounded-panel border border-line bg-panel p-8 text-center"
  >
    <h2 className="text-panel-title font-semibold text-negative">
      A tela não pôde ser carregada
    </h2>
    <p className="mx-auto mt-2 max-w-prose text-[0.8125rem] text-ink-2">
      {error.message}
    </p>
    <button
      type="button"
      className="mt-4 h-control cursor-pointer rounded-control border border-line px-3 text-[0.8125rem] hover:bg-panel-2"
      onClick={onRetry}
    >
      Tentar de novo
    </button>
  </section>
);

export const PerformanceView = ({
  resource,
  period,
  onPeriodChange,
  today,
  extraIds,
  onExtraIdsChange,
}: PerformanceViewProps): React.ReactElement => {
  const { state, pending, reload } = resource;
  const { hidden, toggleHidden } = usePreferences();

  if (state.kind === 'loading') {
    return (
      <p aria-busy="true" className="p-8 text-center text-[0.8125rem] text-ink-3">
        Carregando o desempenho…
      </p>
    );
  }
  if (state.kind === 'error') return <Failed error={state.error} onRetry={reload} />;

  const data = state.value;

  const exportCsv = (): void => {
    const blob = new Blob([CSV_BOM, decompositionCsv(data.decomposition)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = csvFilename(today);
    link.click();
    URL.revokeObjectURL(url);
  };

  const subtitle = [
    data.scope.name,
    'rentabilidade pela cota, sem distorção de aportes',
    data.reference_date === null
      ? null
      : `fechamento de ${formatDate(data.reference_date as DateOnly)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-screen-title font-semibold tracking-tight">Desempenho</h1>
          <p className="truncate text-[0.8125rem] text-ink-2">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <PeriodControl
            value={period}
            onChange={onPeriodChange}
            today={today}
            inception={data.scope.inception}
          />
          <IconButton
            label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
            aria-pressed={hidden}
            onClick={toggleHidden}
          >
            <span aria-hidden="true">{hidden ? '◌' : '◉'}</span>
          </IconButton>
        </div>
      </header>

      {data.reference_date === null ? (
        <Empty scope={data.scope.name} />
      ) : (
        <KeepPrevious pending={pending} className="flex flex-col gap-4">
          <Accumulated
            data={data}
            period={period}
            today={today}
            extraIds={extraIds}
            onExtraIdsChange={onExtraIdsChange}
          />
          <Monthly data={data} />
          <Decomposition decomposition={data.decomposition} onExport={exportCsv} />
          <Breakdown data={data} />
          <Method data={data} />
        </KeepPrevious>
      )}
    </div>
  );
};
