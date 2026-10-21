import type { PerformanceResource } from '@patrimonio/contracts';
import { normalizeBenchmark } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { useRef, useState } from 'react';

import { Chip } from '../components/primitives.js';
import { SeriesChart } from '../components/series_chart.js';
import { useDismiss } from '../components/use_dismiss.js';
import { formatDate, monthTicks } from '../lib/overview.js';
import {
  PORTFOLIO_COLOR,
  addBenchmark,
  availableToAdd,
  benchmarkColor,
  chartSeries,
  extraBenchmarks,
  removeBenchmark,
} from '../lib/performance.js';

/**
 * O retorno da carteira dentro da Visão geral: o gráfico acumulado contra os
 * benchmarks e o método dos números. É o que a antiga tela de Desempenho
 * mostrava, agora na mesma tela do patrimônio, mas em gráfico próprio: aporte
 * em reais e retorno em percentual respondem perguntas diferentes.
 *
 * Nada aqui faz conta. Retorno e diferença em pontos chegam prontos; a tela
 * escolhe cor, casa decimal e ordem.
 */

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

  const [draft, setDraft] = useState('');
  const typed = normalizeBenchmark(draft);

  const add = (id: string): void => {
    onPick(id);
    setDraft('');
    setOpen(false);
  };

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
                onClick={() => add(option.id)}
              >
                {option.name}
              </button>
            </li>
          ))}
          <li role="none" className="mt-1 border-t border-line px-2 pt-2 pb-1">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (typed !== null) add(typed);
              }}
            >
              <input
                type="text"
                aria-label="Outro benchmark"
                placeholder="IPCA+6 ou 110%CDI"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="h-control w-full rounded-control border border-line bg-panel px-2 text-[0.8125rem]"
              />
              {draft !== '' && typed === null ? (
                <p role="alert" className="mt-1 text-[0.75rem] text-ink-3">
                  Use CDI, IPCA+6 ou 110%CDI.
                </p>
              ) : null}
            </form>
          </li>
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

/**
 * O gráfico de retorno acumulado, com os benchmarks escolhidos como etiquetas
 * removíveis e o aviso do que não tem série no período.
 */
export const ReturnsChart = ({
  data,
  extraIds,
  onExtraIdsChange,
}: {
  readonly data: PerformanceResource;
  readonly extraIds: readonly string[];
  readonly onExtraIdsChange: (ids: readonly string[]) => void;
}): React.ReactElement => {
  const { benchmarks, chart, scope } = data;
  const primary = benchmarks.selected.find((item) => item.id === benchmarks.primary_id);
  const extras = extraBenchmarks(benchmarks.selected, benchmarks.primary_id);
  const ticks = monthTicks(chart.dates as DateOnly[]);

  const gapIds = new Set(benchmarks.gaps.map((gap) => gap.id));
  const missing = benchmarks.selected.filter(
    (item) =>
      !gapIds.has(item.id) && !chart.benchmarks.some((line) => line.id === item.id),
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
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

      {chart.dates.length === 0 ? (
        <p className="flex min-h-40 items-center justify-center text-[0.8125rem] text-ink-3">
          Sem consolidação no período escolhido.
        </p>
      ) : (
        <SeriesChart
          dates={chart.dates as DateOnly[]}
          series={chartSeries(chart, benchmarks.selected, scope.name)}
          valueFormat="percent"
          endLabels
          inception={scope.inception as DateOnly | null}
          ariaLabel="Retorno acumulado da carteira contra os benchmarks"
          xTickLabel={(date) => ticks.get(date) ?? ''}
          tooltipDateLabel={(date) => formatDate(date)}
        />
      )}

      {benchmarks.gaps.length === 0 ? null : (
        <p className="text-[0.75rem] text-attention">
          Falta série para o período:{' '}
          {benchmarks.gaps
            .map((gap) =>
              gap.available_from === null
                ? `${gap.name} (nenhum dado coletado)`
                : `${gap.name} (série a partir de ${formatDate(gap.available_from as DateOnly)})`,
            )
            .join('; ')}
          . O benchmark aparece como traço, e não como uma linha mais curta. Carregue o
          histórico com pnpm seed:indices.
        </p>
      )}
      {missing.length === 0 ? null : (
        <p className="text-[0.75rem] text-attention">
          Sem dado de índice no período: {missing.map((item) => item.name).join(', ')}.
          Eles aparecem como traço, e não como zero.
        </p>
      )}
    </div>
  );
};
