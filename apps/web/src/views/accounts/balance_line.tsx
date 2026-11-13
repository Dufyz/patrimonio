import { useId, useState } from 'react';

import type { DailyPoint } from '../../lib/statement_view.js';
import { lowestPoint } from '../../lib/statement_view.js';
import { dayMonth } from '../../lib/statement_view.js';

/**
 * CTA-03 · Saldo dia a dia: linha com área, um ponto por dia, realizado cheio
 * até hoje e previsto tracejado depois, com o menor saldo marcado. Os valores
 * viram número só para a geometria; o que aparece em texto é a string do
 * servidor.
 */
const W = 720;
const H = 200;
const PAD = { top: 16, right: 12, bottom: 22, left: 12 } as const;

export const BalanceLine = ({
  points,
  format,
}: {
  readonly points: readonly DailyPoint[];
  readonly format: (value: string) => string;
}): React.ReactElement | null => {
  const gradient = useId();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;

  const nums = points.map((p) => Number(p.balance));
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number): number =>
    PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (n: number): number => PAD.top + innerH - ((n - lo) / span) * innerH;

  const firstProjected = points.findIndex((p) => p.projected);
  const split = firstProjected === -1 ? points.length : Math.max(firstProjected, 1);
  const path = (from: number, to: number): string =>
    points
      .slice(from, to)
      .map(
        (p, k) =>
          `${k === 0 ? 'M' : 'L'}${x(from + k).toFixed(1)},${y(Number(p.balance)).toFixed(1)}`,
      )
      .join(' ');

  const real = path(0, split);
  const projected = firstProjected === -1 ? '' : path(split - 1, points.length);
  const area = `${real} L${x(split - 1).toFixed(1)},${H - PAD.bottom} L${x(0).toFixed(1)},${H - PAD.bottom} Z`;
  const low = lowestPoint(points);
  const lowIndex = low === null ? -1 : points.indexOf(low);
  const shown = hover === null ? null : (points[hover] ?? null);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Saldo dia a dia"
        className="w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - box.left) / box.width;
          const i = Math.round(((ratio * W - PAD.left) / innerW) * (points.length - 1));
          setHover(Math.min(points.length - 1, Math.max(0, i)));
        }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradient})`} />
        <path d={real} fill="none" stroke="var(--accent)" strokeWidth="2" />
        {projected !== '' && (
          <path
            d={projected}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeDasharray="5 4"
            data-testid="projected"
          />
        )}
        {low !== null && (
          <g data-testid="lowest">
            <circle
              cx={x(lowIndex)}
              cy={y(Number(low.balance))}
              r="4"
              fill="var(--negative)"
            />
            <text
              x={x(lowIndex)}
              y={y(Number(low.balance)) - 8}
              textAnchor="middle"
              fontSize="11"
              fill="var(--ink-2)"
            >
              {`${format(low.balance)} · ${dayMonth(low.date)}`}
            </text>
          </g>
        )}
        {hover !== null && shown !== null && (
          <circle
            cx={x(hover)}
            cy={y(Number(shown.balance))}
            r="3.5"
            fill="var(--accent)"
          />
        )}
        <text x={PAD.left} y={H - 6} fontSize="11" fill="var(--ink-3)">
          {dayMonth(points[0]?.date ?? '')}
        </text>
        <text
          x={W - PAD.right}
          y={H - 6}
          fontSize="11"
          textAnchor="end"
          fill="var(--ink-3)"
        >
          {dayMonth(points[points.length - 1]?.date ?? '')}
        </text>
      </svg>
      <figcaption className="min-h-5 text-xs text-ink-3" aria-live="polite">
        {shown === null
          ? ' '
          : `${dayMonth(shown.date)} · ${format(shown.balance)}${shown.projected ? ' (previsto)' : ''}`}
      </figcaption>
    </figure>
  );
};
