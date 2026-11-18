import { useRef } from 'react';

import { fetchFlowSeries } from '../../api/flow_series.js';
import type { FlowSeriesMonth } from '../../api/flow_series.js';
import { Panel } from '../../components/primitives.js';
import { useElementWidth } from '../../components/use_element_width.js';
import { niceTicks, toNumber } from '../../lib/chart/scale.js';
import { useResource } from '../../lib/use_resource.js';
import type { IsoDate } from '../lib/dates.js';
import { formatMonthShort } from '../lib/format.js';
import { PanelBoundary, PanelError, PanelLoading } from './states.js';

/**
 * Receitas × despesas (prancha 1.2): uma barra de receita e uma de despesa por
 * mês, a linha tracejada dos aportes (despesa financeira) e o mês corrente em
 * contorno tracejado, com o que está previsto. Os valores vêm do livro do
 * servidor; aqui só há geometria.
 */

const HEIGHT = 230;
const MARGIN = { top: 12, right: 12, bottom: 28, left: 44 } as const;

const axisLabel = (value: number): string =>
  value === 0 ? '0' : `${Math.round(value / 1000)}k`;

const num = (value: string): number => toNumber(value) ?? 0;

const Chart = ({
  months,
  currentMonth,
}: {
  readonly months: readonly FlowSeriesMonth[];
  readonly currentMonth: string;
}): React.ReactElement => {
  const container = useRef<HTMLDivElement>(null);
  const width = useElementWidth(container, 720);
  const svgWidth = Math.max(1, width - 40);
  const plotWidth = Math.max(1, svgWidth - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const view = months.map((point) => {
    const current = point.month === currentMonth;
    const source = current ? point.projetado : point;
    return {
      month: point.month,
      current,
      receitas: num(source.receitas),
      despesas: num(source.despesas),
      aportes: num(source.aportes),
    };
  });
  const max = Math.max(1, ...view.flatMap((p) => [p.receitas, p.despesas, p.aportes]));
  const ticks = niceTicks(0, max * 1.05, 5);
  const top = Math.max(1, ticks.at(-1) ?? max);
  const y = (value: number): number => plotHeight - (value / top) * plotHeight;
  const slot = plotWidth / Math.max(1, view.length);
  const bar = Math.max(3, Math.min(30, slot / 2 - 4));

  return (
    <div ref={container} className="px-5 pt-4 pb-4">
      <svg
        role="img"
        aria-label="Receitas, despesas e aportes por mês; o mês corrente mostra o previsto"
        viewBox={`0 0 ${svgWidth} ${HEIGHT}`}
        className="block w-full overflow-visible"
        style={{ height: HEIGHT }}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={0}
                x2={plotWidth}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-line"
              />
              <text
                x={-8}
                y={y(tick) + 3}
                textAnchor="end"
                className="tabular fill-ink-3 text-label"
              >
                {axisLabel(tick)}
              </text>
            </g>
          ))}
          {view.map((point, index) => {
            const cx = index * slot + slot / 2;
            const dashed = point.current
              ? { strokeDasharray: '3 2', strokeWidth: 1.25 }
              : {};
            return (
              <g key={point.month} data-month={point.month}>
                <rect
                  x={cx - bar - 1}
                  y={y(point.receitas)}
                  width={bar}
                  height={plotHeight - y(point.receitas)}
                  rx={2}
                  className={
                    point.current ? 'fill-positive/30 stroke-positive' : 'fill-positive'
                  }
                  {...dashed}
                />
                <rect
                  x={cx + 1}
                  y={y(point.despesas)}
                  width={bar}
                  height={plotHeight - y(point.despesas)}
                  rx={2}
                  className={point.current ? 'fill-ink-3/30 stroke-ink-3' : 'fill-ink-3'}
                  {...dashed}
                />
                <text
                  x={cx}
                  y={plotHeight + 18}
                  textAnchor="middle"
                  className="tabular fill-ink-3 text-label"
                >
                  {formatMonthShort(`${point.month}-01` as IsoDate)}
                </text>
              </g>
            );
          })}
          <polyline
            fill="none"
            className="stroke-accent"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            points={view
              .map((point, index) => `${index * slot + slot / 2},${y(point.aportes)}`)
              .join(' ')}
          />
          {view.map((point, index) => (
            <circle
              key={point.month}
              cx={index * slot + slot / 2}
              cy={y(point.aportes)}
              r={3}
              className="fill-accent stroke-panel"
            />
          ))}
        </g>
      </svg>
      <p className="tabular mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.8125rem] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-xs bg-positive"
          />
          Receitas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-xs bg-ink-3"
          />
          Despesas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2 rounded-full bg-accent"
          />
          Aportes <span className="text-ink-3">(despesa financeira)</span>
        </span>
        <span className="text-ink-3">Barras tracejadas: mês corrente, previsto.</span>
      </p>
    </div>
  );
};

export const ReceitasDespesasPanel = ({
  today,
}: {
  readonly today: IsoDate;
}): React.ReactElement => {
  const month = today.slice(0, 7);
  const series = useResource((signal) => fetchFlowSeries({ month }, signal), [month]);
  const state = series.state;
  return (
    <Panel
      title="Receitas × despesas"
      action={
        <span className="text-xs text-ink-3">
          últimos 11 meses e o mês corrente, com os aportes
        </span>
      }
    >
      <PanelBoundary title="o gráfico">
        {state.kind === 'loading' ? (
          <PanelLoading label="Carregando receitas e despesas" rows={4} columns={3} />
        ) : state.kind === 'error' ? (
          <PanelError
            title="Não foi possível carregar receitas e despesas"
            onRetry={series.reload}
          />
        ) : (
          <Chart months={state.value.months} currentMonth={month} />
        )}
      </PanelBoundary>
    </Panel>
  );
};
