import { useId, useRef, useState } from 'react';

import { useElementWidth } from '../../components/use_element_width.js';
import type { DailyBalance } from '../domain/accounts.js';
import { formatBRL, formatDay } from '../lib/format.js';
import { Amount } from './amount.js';

/**
 * FIN-406 · Saldo dia a dia.
 *
 * Linha com área suave, um ponto por dia. O ponto inicial é escuro (saldo de
 * abertura) e o final é azul (saldo atual). Eixo X com datas a cada quatro dias,
 * eixo Y com três valores de saldo. A dica mostra a data e o saldo do dia sob o
 * cursor. A linha termina em hoje quando o período vai além.
 */

const HEIGHT = 220;
const MARGIN = { top: 14, right: 16, bottom: 26, left: 16 } as const;
const TICK_EVERY = 4;

export const BalanceChart = ({
  points,
  today,
  name,
}: {
  readonly points: readonly DailyBalance[];
  readonly today: string;
  readonly name: string;
}): React.ReactElement | null => {
  const gradient = useId();
  const container = useRef<HTMLDivElement>(null);
  const width = useElementWidth(container, 720);
  const [hover, setHover] = useState<number | null>(null);

  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;

  const svgWidth = Math.max(1, width - 40);
  const plotWidth = Math.max(1, svgWidth - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const values = points.map((point) => point.cents);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max(1, Math.round((high - low) * 0.12)) || 100;
  const min = low - pad;
  const max = high + pad;

  const x = (index: number): number =>
    points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth;
  const y = (cents: number): number =>
    plotHeight - ((cents - min) / (max - min)) * plotHeight;

  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.cents).toFixed(1)}`,
    )
    .join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${plotHeight} L${x(0).toFixed(1)},${plotHeight} Z`;

  const lastIndex = points.length - 1;
  const tickIndexes = Array.from(
    { length: Math.floor(lastIndex / TICK_EVERY) + 1 },
    (_, n) => n * TICK_EVERY,
  );
  // o último dia sempre leva rótulo; o anterior sai se encostar nele
  if (tickIndexes[tickIndexes.length - 1] !== lastIndex) {
    if (lastIndex - (tickIndexes[tickIndexes.length - 1] ?? 0) < 2) tickIndexes.pop();
    tickIndexes.push(lastIndex);
  }
  const xTicks = tickIndexes.flatMap((index) => {
    const point = points[index];
    return point === undefined ? [] : [{ point, index }];
  });

  const onMove = (event: React.MouseEvent<SVGRectElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = box.width === 0 ? 0 : (event.clientX - box.left) / box.width;
    setHover(
      Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))),
    );
  };

  const hovered = hover === null ? null : (points[hover] ?? null);
  const label = `Saldo dia a dia de ${name}: de ${formatBRL(first.cents)} em ${formatDay(first.date, today)} a ${formatBRL(last.cents)} em ${formatDay(last.date, today)}`;

  return (
    <div ref={container} className="relative px-5 pb-4">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${svgWidth} ${HEIGHT}`}
        className="block w-full overflow-visible"
        style={{ height: HEIGHT }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <line
            x1={0}
            x2={plotWidth}
            y1={plotHeight}
            y2={plotHeight}
            className="stroke-line-2"
          />
          <path d={area} fill={`url(#${gradient})`} />
          <path
            d={line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-accent"
          />
          {xTicks.map(({ point, index }) => (
            <text
              key={point.date}
              x={x(index)}
              y={plotHeight + 18}
              textAnchor={
                index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'
              }
              className="tabular fill-ink-3 text-label"
            >
              {formatDay(point.date, today)}
            </text>
          ))}
          <circle
            data-testid="balance-start"
            cx={x(0)}
            cy={y(first.cents)}
            r={4.5}
            className="fill-ink stroke-panel"
            strokeWidth={2}
          />
          <circle
            data-testid="balance-end"
            cx={x(points.length - 1)}
            cy={y(last.cents)}
            r={4.5}
            className="fill-accent stroke-panel"
            strokeWidth={2}
          />
          {hover === null || hovered === null ? null : (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={0}
                y2={plotHeight}
                className="stroke-line-strong"
              />
              <circle
                cx={x(hover)}
                cy={y(hovered.cents)}
                r={4}
                className="fill-accent stroke-panel"
                strokeWidth={2}
              />
            </g>
          )}
          <rect
            data-testid="balance-hit"
            x={0}
            y={0}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        </g>
      </svg>
      {hovered === null || hover === null ? null : (
        <div
          role="tooltip"
          className="tabular pointer-events-none absolute top-2 rounded-control border border-line-2 bg-panel px-2.5 py-1.5 text-xs shadow-panel"
          style={{
            left: `min(max(${MARGIN.left + x(hover) + 8}px, 8px), calc(100% - 9.5rem))`,
          }}
        >
          <div className="text-ink-3">{formatDay(hovered.date, today)}</div>
          <div className="font-semibold">
            <Amount cents={hovered.cents} />
          </div>
        </div>
      )}
    </div>
  );
};
