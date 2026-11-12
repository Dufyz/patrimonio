import { useMemo, useRef, useState } from 'react';

import { useValuesHidden } from '../../components/preferences.js';
import { Panel, Segmented } from '../../components/primitives.js';
import { useElementWidth } from '../../components/use_element_width.js';
import { projectBalance, realizedBalances } from '../domain/projection.js';
import type { ProjectionDay } from '../domain/projection.js';
import type { FinanceData } from '../domain/types.js';
import { addMonths, endOfMonth, startOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { formatDay, formatMonth, formatMonthShort } from '../lib/format.js';
import { Amount } from './amount.js';
import { roundedBRL } from './flow_chart.js';
import { FinTable, Row, Td, Th, THead } from './fin_table.js';

/**
 * Projeção de saldo: o saldo em contas de hoje até uma data, com o que já está
 * previsto e os recorrentes. A parte realizada do mês é a linha cheia; o futuro
 * é tracejado.
 */

export const HORIZONS = ['mes', 'ano', '6m', '12m'] as const;
export type HorizonId = (typeof HORIZONS)[number];

const HORIZON_OPTIONS = [
  { value: 'mes', label: 'Fim do mês' },
  { value: 'ano', label: 'Fim do ano' },
  { value: '6m', label: '6 meses' },
  { value: '12m', label: '12 meses' },
] as const;

export const horizonDate = (id: HorizonId, today: IsoDate): IsoDate => {
  switch (id) {
    case 'mes':
      return endOfMonth(today);
    case 'ano':
      return `${today.slice(0, 4)}-12-31`;
    case '6m':
      return endOfMonth(addMonths(today, 6));
    case '12m':
      return endOfMonth(addMonths(today, 12));
  }
};

const HEIGHT = 250;
const MARGIN = { top: 14, right: 16, bottom: 26, left: 60 } as const;

type Line = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly dashed: boolean;
  readonly strong: boolean;
  /** Valor por índice da linha do tempo; `undefined` onde a linha não existe. */
  readonly values: readonly (number | undefined)[];
};

const pathOf = (
  values: readonly (number | undefined)[],
  x: (index: number) => number,
  y: (cents: number) => number,
): string => {
  let path = '';
  let open = false;
  values.forEach((value, index) => {
    if (value === undefined) {
      open = false;
      return;
    }
    path += `${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)} `;
    open = true;
  });
  return path.trim();
};

export const ProjectionPanel = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
}): React.ReactElement => {
  const [horizonId, setHorizonId] = useState<HorizonId>('ano');
  const horizon = horizonDate(horizonId, today);
  const hiddenValues = useValuesHidden();
  const container = useRef<HTMLDivElement>(null);
  const width = useElementWidth(container, 720);
  const [hover, setHover] = useState<number | null>(null);

  const base = useMemo(
    () => projectBalance(data, today, horizon),
    [data, today, horizon],
  );
  const realized = useMemo<readonly ProjectionDay[]>(
    () => realizedBalances(data, startOfMonth(today), today),
    [data, today],
  );

  const timeline = [...realized.slice(0, -1), ...base.days];
  const todayIndex = Math.max(0, realized.length - 1);
  const pad = (days: readonly ProjectionDay[], from: number): (number | undefined)[] =>
    timeline.map((_, index) => days[index - from]?.cents);

  const lines: Line[] = [
    {
      key: 'real',
      label: 'Realizado',
      color: 'var(--color-ink)',
      dashed: false,
      strong: true,
      values: realized.map((day) => day.cents),
    },
    {
      key: 'base',
      label: 'Projetado',
      color: 'var(--color-accent)',
      dashed: true,
      strong: true,
      values: pad(base.days, todayIndex),
    },
  ];

  const everything = lines.flatMap((line) =>
    line.values.filter((value): value is number => value !== undefined),
  );
  const low = Math.min(0, ...everything);
  const high = Math.max(...everything, 1);
  const span = Math.max(1, high - low);
  const min = low === 0 ? 0 : low - span * 0.06;
  const max = high + span * 0.08;

  const svgWidth = Math.max(1, width - 40);
  const plotWidth = Math.max(1, svgWidth - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const last = Math.max(1, timeline.length - 1);
  const x = (index: number): number => (index / last) * plotWidth;
  const y = (cents: number): number =>
    plotHeight - ((cents - min) / (max - min)) * plotHeight;

  const lowestIndex = timeline.findIndex((day) => day.date === base.lowest.date);
  const yTicks = [min, (min + max) / 2, max].map(
    (value) => Math.round(value / 100000) * 100000,
  );
  const xTicks = timeline.flatMap((day, index) =>
    index === 0 || day.date.endsWith('-01') || index === last ? [{ day, index }] : [],
  );

  const onMove = (event: React.MouseEvent<SVGRectElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = box.width === 0 ? 0 : (event.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(last, Math.round(ratio * last))));
  };
  const hovered = hover === null ? null : (timeline[hover] ?? null);

  const entradas = base.periods.reduce((acc, period) => acc + period.entradas, 0);
  const saidas = base.periods.reduce((acc, period) => acc + period.saidas, 0);

  const label = `Projeção do saldo em contas: de ${roundedBRL(base.startCents)} hoje a ${roundedBRL(base.endCents)} em ${formatDay(horizon, today)}`;

  return (
    <Panel
      title="Projeção de saldo"
      hint="o que já está previsto e os recorrentes"
      action={
        <Segmented
          label="Até quando projetar"
          options={HORIZON_OPTIONS}
          value={horizonId}
          onChange={setHorizonId}
        />
      }
    >
      <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line px-5 py-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-label tracking-[0.08em] text-ink-3 uppercase">
            Em contas hoje
          </dt>
          <dd className="mt-1 text-lg font-semibold">
            <Amount cents={base.startCents} />
          </dd>
        </div>
        <div>
          <dt className="text-label tracking-[0.08em] text-ink-3 uppercase">
            Em {formatDay(horizon, today)}
          </dt>
          <dd className="mt-1 text-lg font-semibold">
            <Amount cents={base.endCents} />
          </dd>
          <dd className="text-xs text-ink-3">
            <Amount cents={base.endCents - base.startCents} variant="delta" /> no período
          </dd>
        </div>
        <div>
          <dt className="text-label tracking-[0.08em] text-ink-3 uppercase">
            Menor saldo
          </dt>
          <dd
            className={`mt-1 text-lg font-semibold ${base.lowest.cents < 0 ? 'text-negative' : ''}`}
          >
            <Amount cents={base.lowest.cents} />
          </dd>
          <dd className="text-xs text-ink-3">em {formatDay(base.lowest.date, today)}</dd>
        </div>
        <div>
          <dt className="text-label tracking-[0.08em] text-ink-3 uppercase">
            Entradas · saídas
          </dt>
          <dd className="mt-1 text-sm font-semibold">
            <Amount cents={entradas} variant="flow" />
          </dd>
          <dd className="text-sm font-semibold">
            <Amount cents={-saidas} variant="flow" />
          </dd>
        </div>
      </dl>

      <div ref={container} className="relative px-5 pt-4 pb-3">
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${svgWidth} ${HEIGHT}`}
          className="block w-full overflow-visible"
          style={{ height: HEIGHT }}
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={0}
                  x2={plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-line-2"
                  strokeDasharray={tick === 0 ? undefined : '2 4'}
                />
                <text
                  x={-8}
                  y={y(tick) + 4}
                  textAnchor="end"
                  className="tabular fill-ink-3 text-label"
                >
                  {hiddenValues ? '•••' : roundedBRL(tick)}
                </text>
              </g>
            ))}
            <line
              data-testid="projection-today"
              x1={x(todayIndex)}
              x2={x(todayIndex)}
              y1={0}
              y2={plotHeight}
              className="stroke-line-strong"
            />
            {lines.map((line) => (
              <path
                key={line.key}
                data-line={line.key}
                d={pathOf(line.values, x, y)}
                fill="none"
                strokeWidth={line.strong ? 2 : 1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={line.dashed ? '5 4' : undefined}
                style={{ stroke: line.color }}
              />
            ))}
            {lowestIndex >= 0 ? (
              <circle
                data-testid="projection-lowest"
                cx={x(lowestIndex)}
                cy={y(base.lowest.cents)}
                r={4.5}
                className={`stroke-panel ${base.lowest.cents < 0 ? 'fill-negative' : 'fill-ink'}`}
                strokeWidth={2}
              />
            ) : null}
            {xTicks.map(({ day, index }) => (
              <text
                key={day.date}
                x={x(index)}
                y={plotHeight + 18}
                textAnchor={index === 0 ? 'start' : index === last ? 'end' : 'middle'}
                className="tabular fill-ink-3 text-label"
              >
                {index === last ? formatDay(day.date, today) : formatMonthShort(day.date)}
              </text>
            ))}
            <text x={x(todayIndex) + 4} y={10} className="tabular fill-ink-3 text-label">
              hoje
            </text>
            {hover === null ? null : (
              <line
                pointerEvents="none"
                x1={x(hover)}
                x2={x(hover)}
                y1={0}
                y2={plotHeight}
                className="stroke-line-strong"
              />
            )}
            <rect
              data-testid="projection-hit"
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
        <p className="tabular mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem]">
          {lines.map((line) => (
            <span key={line.key} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-4"
                style={{
                  backgroundColor: line.dashed ? 'transparent' : line.color,
                  borderTop: line.dashed ? `2px dashed ${line.color}` : undefined,
                }}
              />
              <span className="text-ink-2">{line.label}</span>
            </span>
          ))}
        </p>
        {hovered === null || hover === null ? null : (
          <div
            role="tooltip"
            className="tabular pointer-events-none absolute top-4 rounded-control border border-line-2 bg-panel px-2.5 py-1.5 text-xs shadow-panel"
            style={{
              left: `min(max(${MARGIN.left + x(hover) + 28}px, 8px), calc(100% - 12rem))`,
            }}
          >
            <div className="text-ink-3">{formatDay(hovered.date, today)}</div>
            {lines.map((line) => {
              const value = line.values[hover];
              return value === undefined ? null : (
                <div key={line.key} className="flex items-center justify-between gap-4">
                  <span style={{ color: line.color }}>{line.label}</span>
                  <Amount cents={value} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <FinTable caption="Projeção mês a mês">
        <THead>
          <Th>Mês</Th>
          <Th align="right">Entradas</Th>
          <Th align="right">Saídas</Th>
          <Th align="right">Saldo final</Th>
        </THead>
        <tbody>
          {base.periods.map((period, index) => (
            <Row key={period.key}>
              <Td className="font-medium">
                {formatMonth(`${period.key}-01`)}
                {index === 0 ? (
                  <span className="text-ink-3"> · de hoje em diante</span>
                ) : null}
              </Td>
              <Td numeric>
                <Amount cents={period.entradas} variant="flow" />
              </Td>
              <Td numeric>
                <Amount cents={-period.saidas} variant="flow" />
              </Td>
              <Td numeric>
                <Amount cents={period.endCents} />
              </Td>
            </Row>
          ))}
        </tbody>
      </FinTable>
    </Panel>
  );
};
