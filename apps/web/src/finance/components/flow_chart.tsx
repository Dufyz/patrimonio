import { useRef, useState } from 'react';

import { useValuesHidden } from '../../components/preferences.js';
import { useElementWidth } from '../../components/use_element_width.js';
import type { MonthPoint } from '../domain/overview.js';
import { formatBRL, formatMonthShort } from '../lib/format.js';
import { Amount } from './amount.js';

/**
 * FIN-602 · Receitas × despesas: barras agrupadas dos 12 meses, uma verde de
 * receita e uma cinza de despesa por mês. O mês do período, quando está em
 * andamento, aparece com o tom cheio; os demais ficam mais claros.
 */

const HEIGHT = 220;
const MARGIN = { top: 12, right: 8, bottom: 26, left: 64 } as const;

const compact = (cents: number): string => {
  const value = Math.abs(cents) / 100;
  return value >= 1000
    ? `R$ ${(value / 1000).toFixed(0)} mil`
    : `R$ ${Math.round(value)}`;
};

/** `R$ 16.350`, sem centavos, como na legenda da prancha. */
export const roundedBRL = (cents: number): string =>
  formatBRL(Math.round(cents / 100) * 100).replace(',00', '');

export const FlowChart = ({
  points,
}: {
  readonly points: readonly MonthPoint[];
}): React.ReactElement | null => {
  const container = useRef<HTMLDivElement>(null);
  const width = useElementWidth(container, 720);
  const hiddenValues = useValuesHidden();
  const [hover, setHover] = useState<number | null>(null);

  const selected = points.find((point) => point.selected);
  if (selected === undefined) return null;

  const svgWidth = Math.max(1, width - 40);
  const plotWidth = Math.max(1, svgWidth - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = Math.max(1, ...points.flatMap((point) => [point.receitas, point.despesas]));
  const top = Math.ceil(max / 500_00) * 500_00;
  const slot = plotWidth / points.length;
  const bar = Math.max(2, Math.min(18, (slot - 6) / 2));
  const y = (cents: number): number => plotHeight - (cents / top) * plotHeight;
  const ticks = [0, top / 2, top];
  const hovered = hover === null ? null : (points[hover] ?? null);

  return (
    <div ref={container} className="relative px-5 pb-4">
      <p className="tabular mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem]">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-sm bg-positive"
          />
          Receitas {hiddenValues ? '•••' : roundedBRL(selected.receitas)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-sm bg-ink-3"
          />
          Despesas {hiddenValues ? '•••' : roundedBRL(selected.despesas)}
        </span>
      </p>
      <svg
        role="img"
        aria-label={`Receitas e despesas dos últimos 12 meses; ${formatMonthShort(selected.start)}: receitas ${formatBRL(selected.receitas)}, despesas ${formatBRL(selected.despesas)}`}
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
                x={-10}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="tabular fill-ink-3 text-label"
              >
                {hiddenValues ? '•••' : compact(tick)}
              </text>
            </g>
          ))}
          {points.map((point, index) => {
            const cx = index * slot + slot / 2;
            const strong = point.selected && point.inProgress;
            return (
              <g
                key={point.key}
                data-month={point.key}
                data-strong={strong ? 'true' : 'false'}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={index * slot}
                  y={0}
                  width={slot}
                  height={plotHeight}
                  fill="transparent"
                />
                <rect
                  x={cx - bar - 1}
                  y={y(point.receitas)}
                  width={bar}
                  height={plotHeight - y(point.receitas)}
                  rx={2}
                  className="fill-positive"
                  opacity={strong ? 1 : 0.6}
                />
                <rect
                  x={cx + 1}
                  y={y(point.despesas)}
                  width={bar}
                  height={plotHeight - y(point.despesas)}
                  rx={2}
                  className="fill-ink-3"
                  opacity={strong ? 1 : 0.6}
                />
                <text
                  x={cx}
                  y={plotHeight + 18}
                  textAnchor="middle"
                  className={
                    point.selected
                      ? 'tabular fill-ink text-label font-semibold'
                      : 'tabular fill-ink-3 text-label'
                  }
                >
                  {formatMonthShort(point.start)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {hovered === null || hover === null ? null : (
        <div
          role="tooltip"
          className="tabular pointer-events-none absolute top-8 rounded-control border border-line-2 bg-panel px-2.5 py-1.5 text-xs shadow-panel"
          style={{
            left: `min(max(${MARGIN.left + hover * slot + slot}px, 8px), calc(100% - 11rem))`,
          }}
        >
          <div className="font-semibold">
            {formatMonthShort(hovered.start)}/{hovered.start.slice(0, 4)}
          </div>
          <div>
            Receitas <Amount cents={hovered.receitas} />
          </div>
          <div>
            Despesas <Amount cents={hovered.despesas} />
          </div>
          <div>
            Saldo <Amount cents={hovered.saldo} variant="signed" />
          </div>
        </div>
      )}
    </div>
  );
};
