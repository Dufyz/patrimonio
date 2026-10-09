import type { DateOnly } from '@patrimonio/domain';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { Band, Series } from '../lib/chart/series.js';
import {
  bandPath,
  bandSegments,
  bandValuesOf,
  downsample,
  linePath,
  nearestIndex,
  splitSegments,
  tooltipSide,
  valuesOf,
} from '../lib/chart/series.js';
import { domainOf, linearScale, niceTicks } from '../lib/chart/scale.js';
import { formatCompact, formatPercent } from '../lib/format.js';
import { areaFill } from '../lib/tokens.js';
import { Money, Percent } from './number.js';
import { useElementWidth } from './use_element_width.js';
import { useValuesHidden } from './preferences.js';

/**
 * D-08 · O gráfico de série.
 *
 * Um componente só atende à área empilhada do patrimônio e às linhas de retorno
 * contra benchmark, porque os dois têm o mesmo eixo, a mesma dica e a mesma
 * legenda — e a dica é a parte que mais custa a acertar. O gráfico de barras
 * por mês é outro componente, porque o eixo dele é categórico.
 *
 * As quatro decisões que a prancha e o backlog cobram, e onde elas estão:
 * a dica segue o cursor com linha vertical e mostra todas as séries na data;
 * ela troca de lado perto da borda (`tooltipSide`); clicar na legenda isola ou
 * esconde a série; e buraco aparece como buraco (`splitSegments`), nunca como
 * interpolação.
 */

const MARGIN = { top: 8, right: 12, bottom: 24, left: 52 } as const;
const DEFAULT_HEIGHT = 240;

export type ChartBand = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly values: readonly Band[];
};

export type SeriesChartProps = {
  readonly dates: readonly DateOnly[];
  readonly series?: readonly Series[];
  /** Faixas empilhadas, com o par já resolvido pela `api`. */
  readonly bands?: readonly ChartBand[];
  readonly valueFormat: 'money' | 'percent';
  readonly ariaLabel: string;
  readonly height?: number;
  /** Área empilhada começa em zero; linha de retorno pode descer abaixo dele. */
  readonly fromZero?: boolean;
  readonly xTickLabel: (date: DateOnly) => string;
  readonly tooltipDateLabel: (date: DateOnly) => string;
  readonly width?: number | undefined;
  /** As séries visíveis, para a exportação da tela usar o mesmo recorte. */
  readonly onVisibleChange?: ((visible: readonly string[]) => void) | undefined;
};

export const SeriesChart = ({
  dates,
  series = [],
  bands = [],
  valueFormat,
  ariaLabel,
  height = DEFAULT_HEIGHT,
  fromZero = false,
  xTickLabel,
  tooltipDateLabel,
  width: forcedWidth,
  onVisibleChange,
}: SeriesChartProps): React.ReactElement => {
  const container = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(container, 720);
  const width = forcedWidth ?? measured;
  const hiddenValues = useValuesHidden();

  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null);

  const isVisible = (id: string): boolean =>
    isolated === null ? !hidden.includes(id) : isolated === id;

  const visibleSeries = series.filter((entry) => isVisible(entry.id));
  const visibleBands = bands.filter((entry) => isVisible(entry.id));

  const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(1, height - MARGIN.top - MARGIN.bottom);

  /**
   * Dez anos de série diária são milhares de pontos por série. Reduzir para um
   * ponto por pixel dá o mesmo traço e mantém o cursor fluido — e os extremos
   * de cada balde sobrevivem, então nenhum pico some.
   */
  const reduced = useMemo(
    () =>
      visibleSeries.map((entry) => ({
        ...entry,
        points: downsample(entry.points, Math.max(2, Math.round(plotWidth))),
      })),
    [visibleSeries, plotWidth],
  );

  const values = [
    ...valuesOf(reduced),
    ...visibleBands.flatMap((band) => bandValuesOf(band.values)),
  ];
  const domain = domainOf(values, { fromZero });

  const x = linearScale([0, Math.max(1, dates.length - 1)], [0, plotWidth]);
  const y = linearScale(domain, [plotHeight, 0]);
  const ticks = niceTicks(domain[0], domain[1], 4);

  const xTickIndexes = useMemo(() => {
    if (dates.length === 0) return [];
    const wanted = Math.max(2, Math.min(7, Math.floor(plotWidth / 110)));
    const step = Math.max(1, Math.floor((dates.length - 1) / (wanted - 1)));
    const out: number[] = [];
    for (let index = 0; index < dates.length; index += step) out.push(index);
    if (out.at(-1) !== dates.length - 1) out.push(dates.length - 1);
    return out;
  }, [dates.length, plotWidth]);

  const toggleSeries = (id: string, isolate: boolean): void => {
    if (isolate) {
      setIsolated((current) => (current === id ? null : id));
      return;
    }
    setHidden((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const visibleKey = [...bands.map((band) => band.id), ...series.map((entry) => entry.id)]
    .filter(isVisible)
    .join(',');

  // A exportação da tela leva o mesmo recorte que está no gráfico, então quem
  // está acima precisa saber o que a legenda escondeu.
  useEffect(() => {
    onVisibleChange?.(visibleKey === '' ? [] : visibleKey.split(','));
  }, [visibleKey, onVisibleChange]);

  const onPointer = (event: React.PointerEvent<SVGSVGElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left - MARGIN.left;
    const index = nearestIndex(pointerX, dates.length, x);
    if (index < 0) return;
    setHover({ index, x: x(index) });
  };

  const hovered = hover === null ? undefined : dates[hover.index];
  const side = hover === null ? 'right' : tooltipSide(hover.x, plotWidth, 220);

  return (
    <div ref={container} className="flex w-full flex-col gap-2">
      <div className="relative">
        <svg
          role="img"
          aria-label={ariaLabel}
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="touch-none select-none"
          onPointerMove={onPointer}
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
                  {valueFormat === 'money'
                    ? formatCompact(String(tick), { hidden: hiddenValues, decimals: 0 })
                        .text
                    : formatPercent(String(tick), { decimals: 0 }).text}
                </text>
              </g>
            ))}

            {visibleBands.map((band) =>
              bandSegments(band.values).map((segment, index) => (
                <path
                  key={`${band.id}-${index}`}
                  d={bandPath(segment, x, y)}
                  fill={areaFill(band.color)}
                  stroke={band.color}
                  strokeWidth={1.5}
                  data-series={band.id}
                />
              )),
            )}

            {reduced.map((entry) =>
              splitSegments(entry.points).map((segment, index) => (
                <path
                  key={`${entry.id}-${index}`}
                  d={linePath(segment, x, y)}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth={entry.dashed === true ? 1.5 : 2}
                  strokeDasharray={entry.dashed === true ? '5 4' : undefined}
                  strokeLinejoin="round"
                  data-series={entry.id}
                />
              )),
            )}

            {hover === null ? null : (
              <line
                x1={hover.x}
                x2={hover.x}
                y1={0}
                y2={plotHeight}
                className="stroke-ink-3"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {xTickIndexes.map((index) => {
              const date = dates[index];
              if (date === undefined) return null;
              return (
                <text
                  key={date}
                  x={x(index)}
                  y={plotHeight + 16}
                  textAnchor={
                    index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle'
                  }
                  className="tabular fill-ink-3 text-label"
                >
                  {xTickLabel(date)}
                </text>
              );
            })}
          </g>
        </svg>

        {hover === null || hovered === undefined ? null : (
          <ChartTooltip
            date={tooltipDateLabel(hovered)}
            side={side}
            left={hover.x + MARGIN.left}
            entries={[
              ...visibleBands.map((band) => ({
                id: band.id,
                label: band.label,
                color: band.color,
                value: band.values[hover.index]?.to ?? null,
              })),
              ...visibleSeries.map((entry) => ({
                id: entry.id,
                label: entry.label,
                color: entry.color,
                value: entry.points[hover.index]?.value ?? null,
              })),
            ]}
            valueFormat={valueFormat}
          />
        )}
      </div>

      <ChartLegend
        entries={[
          ...bands.map((band) => ({ id: band.id, label: band.label, color: band.color })),
          ...series.map((entry) => ({
            id: entry.id,
            label: entry.label,
            color: entry.color,
            dashed: entry.dashed === true,
          })),
        ]}
        isVisible={isVisible}
        onToggle={toggleSeries}
      />
    </div>
  );
};

type TooltipEntry = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly value: string | null;
};

/**
 * A dica. Fica fora do SVG, em um `div`, porque texto em HTML herda a fonte e o
 * tema sem repetir nada — e porque dentro do SVG ela seria cortada pelo
 * `viewBox` ao se aproximar da borda.
 */
const ChartTooltip = ({
  date,
  entries,
  side,
  left,
  valueFormat,
}: {
  readonly date: string;
  readonly entries: readonly TooltipEntry[];
  readonly side: 'left' | 'right';
  readonly left: number;
  readonly valueFormat: 'money' | 'percent';
}): React.ReactElement => (
  <div role="status" className="pointer-events-none absolute top-2 right-0 left-0 h-0">
    <div
      className="absolute top-0 w-[13.75rem] rounded-control border border-line bg-panel p-2 shadow-lg"
      style={side === 'right' ? { left } : { right: '0.75rem' }}
    >
      <p className="tabular mb-1 text-label text-ink-3">{date}</p>
      {entries.map((entry) => (
        <p
          key={entry.id}
          className="flex items-center justify-between gap-3 text-[0.8125rem]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-xs"
              style={{ backgroundColor: entry.color }}
            />
            <span className="truncate text-ink-2">{entry.label}</span>
          </span>
          {valueFormat === 'money' ? (
            <Money value={entry.value} />
          ) : (
            <Percent value={entry.value} signed />
          )}
        </p>
      ))}
    </div>
  </div>
);

/**
 * A legenda é o controle de visibilidade. Um clique isola a série — é o gesto
 * de "quero ver só esta" —, e um clique com Alt esconde só ela, que é o gesto
 * de "esta está atrapalhando". A dica de cada item diz isso em palavras.
 */
const ChartLegend = ({
  entries,
  isVisible,
  onToggle,
}: {
  readonly entries: readonly {
    readonly id: string;
    readonly label: string;
    readonly color: string;
    readonly dashed?: boolean;
  }[];
  readonly isVisible: (id: string) => boolean;
  readonly onToggle: (id: string, isolate: boolean) => void;
}): React.ReactElement => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1">
    {entries.map((entry) => (
      <li key={entry.id}>
        <button
          type="button"
          aria-pressed={isVisible(entry.id)}
          title="Clique para isolar a série; Alt+clique para escondê-la"
          className={`flex cursor-pointer items-center gap-1.5 text-[0.8125rem] ${
            isVisible(entry.id) ? 'text-ink-2' : 'text-ink-3 line-through'
          }`}
          onClick={(event) => onToggle(entry.id, !event.altKey)}
        >
          {/* O traço da legenda repete o traço do gráfico: benchmark é
              tracejado lá e aqui, senão a legenda não identifica a linha. */}
          <span
            aria-hidden="true"
            className="inline-block h-0 w-4 border-t-2"
            style={{
              borderColor: entry.color,
              borderStyle: entry.dashed === true ? 'dashed' : 'solid',
            }}
          />
          {entry.label}
        </button>
      </li>
    ))}
  </ul>
);
