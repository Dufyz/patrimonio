import { useRef, useState } from 'react';

import {
  bandScale,
  domainOf,
  linearScale,
  niceTicks,
  toNumber,
} from '../lib/chart/scale.js';
import { formatCompact } from '../lib/format.js';
import { Money } from './number.js';
import { useValuesHidden } from './preferences.js';
import { useElementWidth } from './use_element_width.js';

/**
 * D-08 · Proventos por mês.
 *
 * O terceiro gráfico da aplicação, e o único de eixo categórico: cada barra é
 * um mês, e meses podem ser empilhados por tipo — dividendo, JCP, juros, aluguel
 * — porque a pergunta "de onde veio o provento" vem logo depois de "quanto
 * recebi".
 *
 * As barras começam em zero, sempre. Um eixo de barras que começa em outro
 * lugar exagera a diferença entre dois meses, e é o jeito mais comum de um
 * gráfico mentir sem dizer nada falso.
 */

const MARGIN = { top: 8, right: 12, bottom: 26, left: 52 } as const;

export type MonthlyBarSlice = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
};

export type MonthlyBar = {
  readonly label: string;
  /** Um valor por fatia, na ordem de `slices`. */
  readonly values: readonly (string | null)[];
  readonly total: string | null;
};

export const MonthlyBarsChart = ({
  bars,
  slices,
  ariaLabel,
  height = 200,
  width: forcedWidth,
  onSelectBar,
}: {
  readonly bars: readonly MonthlyBar[];
  readonly slices: readonly MonthlyBarSlice[];
  readonly ariaLabel: string;
  readonly height?: number;
  readonly width?: number | undefined;
  readonly onSelectBar?: ((index: number) => void) | undefined;
}): React.ReactElement => {
  const container = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(container, 720);
  const width = forcedWidth ?? measured;
  const hiddenValues = useValuesHidden();
  const [hover, setHover] = useState<number | null>(null);

  const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(1, height - MARGIN.top - MARGIN.bottom);

  const hoveredBar = hover === null ? undefined : bars[hover];

  const totals = bars
    .map((bar) => toNumber(bar.total))
    .filter((value): value is number => value !== null);
  const domain = domainOf(totals, { fromZero: true });
  const y = linearScale(domain, [plotHeight, 0]);
  const band = bandScale(bars.length, plotWidth);
  const ticks = niceTicks(domain[0], domain[1], 3);

  return (
    <div ref={container} className="relative flex w-full flex-col gap-2">
      <svg
        role="img"
        aria-label={ariaLabel}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onPointerLeave={() => setHover(null)}
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
                strokeWidth={1}
              />
              <text
                x={-8}
                y={y(tick)}
                dominantBaseline="middle"
                textAnchor="end"
                className="tabular fill-ink-3 text-label"
              >
                {formatCompact(String(tick), { hidden: hiddenValues, decimals: 0 }).text}
              </text>
            </g>
          ))}

          {bars.map((bar, index) => {
            let cursor = 0;

            return (
              <g
                // A chave é a posição, e não o rótulo: o eixo de doze meses da
                // página do ativo é a inicial de cada um, e `M`, `J` e `A`
                // aparecem duas vezes. Com a chave no rótulo, React descarta a
                // segunda barra de cada par.
                key={index}
                onPointerMove={() => setHover(index)}
                {...(onSelectBar === undefined
                  ? {}
                  : { onClick: () => onSelectBar(index), className: 'cursor-pointer' })}
              >
                <rect
                  x={band.at(index)}
                  y={0}
                  width={band.bandWidth}
                  height={plotHeight}
                  fill="transparent"
                />
                {slices.map((slice, sliceIndex) => {
                  const value = toNumber(bar.values[sliceIndex] ?? null);
                  if (value === null || value === 0) return null;

                  const top = cursor + value;
                  const rect = {
                    y: y(top),
                    height: Math.max(1, y(cursor) - y(top)),
                  };
                  cursor = top;

                  return (
                    <rect
                      key={slice.id}
                      x={band.at(index)}
                      y={rect.y}
                      width={band.bandWidth}
                      height={rect.height}
                      fill={slice.color}
                      data-slice={slice.id}
                    />
                  );
                })}
                <text
                  x={band.at(index) + band.bandWidth / 2}
                  y={plotHeight + 16}
                  textAnchor="middle"
                  className="tabular fill-ink-3 text-label"
                >
                  {bar.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {hoveredBar === undefined ? null : (
        <div
          role="status"
          className="pointer-events-none absolute top-2 right-3 rounded-control border border-line bg-panel p-2 text-[0.8125rem] shadow-lg"
        >
          <p className="tabular mb-1 text-label text-ink-3">{hoveredBar.label}</p>
          {slices.map((slice, sliceIndex) => (
            <p key={slice.id} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-xs"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="text-ink-2">{slice.label}</span>
              </span>
              <Money value={hoveredBar.values[sliceIndex] ?? null} />
            </p>
          ))}
          <p className="mt-1 flex justify-between gap-3 border-t border-line pt-1 font-medium">
            <span>Total</span>
            <Money value={hoveredBar.total} />
          </p>
        </div>
      )}

      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {slices.map((slice) => (
          <li
            key={slice.id}
            className="flex items-center gap-1.5 text-[0.8125rem] text-ink-2"
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-xs"
              style={{ backgroundColor: slice.color }}
            />
            {slice.label}
          </li>
        ))}
      </ul>
    </div>
  );
};
