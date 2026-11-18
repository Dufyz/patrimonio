import { useEffect, useRef, useState } from 'react';

import { fetchForecast } from '../../api/forecast.js';
import type { ForecastResource } from '../../api/forecast.js';
import { Panel } from '../../components/primitives.js';
import { useElementWidth } from '../../components/use_element_width.js';
import { niceTicks, toNumber } from '../../lib/chart/scale.js';
import { formatDate } from '../../lib/overview.js';
import { useResource } from '../../lib/use_resource.js';
import { endOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { financeRoutes } from '../lib/routes.js';
import { decimalToCents } from '../lib/money.js';
import type { Cents } from '../lib/money.js';
import { Amount } from './amount.js';
import { PanelError, PanelLoading } from './states.js';
import { PanelHeaderAction } from './overview_panels.js';
import type { DateOnly } from '@patrimonio/domain';

/**
 * Saldo previsto em contas (prancha 1.2): o saldo dia a dia, em degraus, do dia
 * de hoje ao fim do mês, só caixa. Cada degrau é um lançamento previsto; o ponto
 * marca o dia em que o saldo muda. Os números são do servidor (RN-U16).
 */

const HEIGHT = 250;
const MARGIN = { top: 14, right: 16, bottom: 26, left: 44 } as const;

const axisLabel = (value: number): string => {
  if (value === 0) return '0';
  const thousands = value / 1000;
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1).replace('.', ',')}k`;
};

const dayOf = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

const Steps = ({
  forecast,
  today,
}: {
  readonly forecast: ForecastResource;
  readonly today: IsoDate;
}): React.ReactElement => {
  const container = useRef<HTMLDivElement>(null);
  const width = useElementWidth(container, 640);
  // O gráfico ocupa a altura que o card tiver (o card cresce para acompanhar o
  // de Despesas por categoria ao lado), nunca menos que a altura padrão.
  const [boxHeight, setBoxHeight] = useState(HEIGHT);
  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const measure = (): void => {
      const measured = element.getBoundingClientRect().height - 24;
      if (measured > 0) setBoxHeight(Math.max(HEIGHT, Math.floor(measured)));
    };
    measure();
    if (typeof globalThis.ResizeObserver !== 'function') return;
    const observer = new globalThis.ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const chartHeight = boxHeight;
  const svgWidth = Math.max(1, width - 32);
  const plotWidth = Math.max(1, svgWidth - MARGIN.left - MARGIN.right);
  const plotHeight = chartHeight - MARGIN.top - MARGIN.bottom;

  const points = forecast.series.points
    .map((p) => ({ date: p.date, day: dayOf(p.date), value: toNumber(p.balance) ?? 0 }))
    .filter((p) => p.date >= today);
  if (points.length === 0) return <></>;

  const first = points[0]!.day;
  const last = points[points.length - 1]!.day;
  const span = Math.max(1, last - first);
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values) * 1.05;
  const ticks = niceTicks(min, max, 4);
  const lo = ticks[0] ?? min;
  const hi = Math.max(ticks.at(-1) ?? max, max);
  const x = (day: number): number => ((day - first) / span) * plotWidth;
  const y = (value: number): number =>
    plotHeight - ((value - lo) / Math.max(1e-9, hi - lo)) * plotHeight;

  // Degrau: o saldo vale até o dia seguinte da mudança.
  let path = `M${x(points[0]!.day)},${y(points[0]!.value)}`;
  const changes: typeof points = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (cur.value === prev.value) continue;
    path += ` H${x(cur.day)} V${y(cur.value)}`;
    changes.push(cur);
  }
  path += ` H${x(last)}`;
  const area = `${path} V${y(lo)} H${x(points[0]!.day)} Z`;
  const endValue = points[points.length - 1]!.value;
  const labelDays = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(first + span * f));
  const iso = (day: number): string =>
    new Date(day * 86_400_000).toISOString().slice(0, 10);

  return (
    <div
      ref={container}
      className="relative min-h-0 flex-1 px-4 pt-4 pb-2"
      style={{ minHeight: HEIGHT + 24 }}
    >
      <svg
        role="img"
        aria-label="Saldo previsto em contas, dia a dia, até o fim do mês"
        viewBox={`0 0 ${svgWidth} ${chartHeight}`}
        className="absolute inset-x-4 top-4 block overflow-visible"
        style={{ height: chartHeight, width: svgWidth }}
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
          <path d={area} className="fill-accent/10" />
          <path d={path} fill="none" className="stroke-accent" strokeWidth={1.75} />
          <line
            x1={0}
            x2={0}
            y1={0}
            y2={plotHeight}
            className="stroke-ink-3"
            strokeDasharray="3 3"
          />
          <text x={6} y={10} className="tabular fill-ink-3 text-label">
            hoje
          </text>
          {changes.map((p) => (
            <circle
              key={p.date}
              cx={x(p.day)}
              cy={y(p.value)}
              r={3.5}
              className="fill-panel stroke-ink"
              strokeWidth={1.25}
            />
          ))}
          <text
            x={plotWidth}
            y={y(endValue) - 8}
            textAnchor="end"
            className="tabular fill-ink text-xs font-semibold"
          >
            {forecast.series.at_end.replace('.', ',')}
          </text>
          {labelDays.map((day, index) => (
            <text
              key={day}
              x={x(day)}
              y={plotHeight + 18}
              textAnchor={
                index === 0 ? 'start' : index === labelDays.length - 1 ? 'end' : 'middle'
              }
              className="tabular fill-ink-3 text-label"
            >
              {`${iso(day).slice(8, 10)}/${iso(day).slice(5, 7)}`}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
};

export const SaldoPrevistoContasPanel = ({
  today,
}: {
  readonly today: IsoDate;
}): React.ReactElement => {
  const to = endOfMonth(today);
  const forecast = useResource(
    (signal) => fetchForecast({ from: today, to }, signal),
    [today, to],
  );
  const state = forecast.state;
  const hint = `${formatDate(today as DateOnly).slice(0, 5)} – ${formatDate(to as DateOnly).slice(0, 5)} · só caixa`;

  let body: React.ReactElement;
  if (state.kind === 'loading') {
    body = <PanelLoading label="Carregando o saldo previsto" rows={4} columns={2} />;
  } else if (state.kind !== 'ready') {
    body = (
      <PanelError
        title="Não foi possível carregar o saldo previsto"
        onRetry={forecast.reload}
      />
    );
  } else {
    const lowest = state.value.series.lowest;
    body = (
      <>
        <Steps forecast={state.value} today={today} />
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[0.8125rem] text-ink-2">
          <span>
            {lowest === null ? (
              'Sem movimentações previstas até o fim do mês.'
            ) : (
              <>
                Menor saldo:{' '}
                <strong className="tabular font-semibold text-ink">
                  <Amount cents={(decimalToCents(lowest.balance) ?? 0) as Cents} />
                </strong>{' '}
                em {formatDate(lowest.date as DateOnly).slice(0, 5)}
              </>
            )}
          </span>
        </div>
      </>
    );
  }
  return (
    <Panel
      title="Saldo previsto em contas"
      action={
        <PanelHeaderAction
          hint={hint}
          more={{
            to: financeRoutes.entries('situacao=previsto'),
            label: 'Ver previstos',
          }}
        />
      }
      className="flex h-full flex-col"
    >
      {body}
    </Panel>
  );
};
