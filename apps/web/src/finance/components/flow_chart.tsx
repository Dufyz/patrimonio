import { useRef, useState } from 'react';

import { useValuesHidden } from '../../components/preferences.js';
import { useElementWidth } from '../../components/use_element_width.js';
import type { MonthPoint } from '../domain/overview.js';
import type { ProjectedMonth } from '../domain/projection.js';
import { formatBRL, formatMonthShort } from '../lib/format.js';
import { Amount } from './amount.js';

/**
 * FIN-602 · Receitas × despesas: barras agrupadas dos 12 meses, uma verde de
 * receita e uma cinza de despesa por mês. O mês do período, quando está em
 * andamento, aparece com o tom cheio; os demais ficam mais claros.
 *
 * Com `projected`, os próximos meses entram à direita em contorno tracejado: é o
 * que está previsto e os recorrentes, não o que aconteceu.
 */

const HEIGHT = 220;
const COMPACT_HEIGHT = 150;
/** Abaixo disto o gráfico encolhe e mostra um rótulo de mês a cada dois (FIN-702). */
const COMPACT_BELOW = 520;
const MARGIN = { top: 12, right: 8, bottom: 26, left: 8 } as const;

/** `R$ 16.350`, sem centavos, como na legenda da prancha. */
export const roundedBRL = (cents: number): string =>
  formatBRL(Math.round(cents / 100) * 100).replace(',00', '');

type Slot = {
  readonly key: string;
  readonly start: string;
  readonly receitas: number;
  readonly despesas: number;
  readonly saldo: number;
  readonly selected: boolean;
  readonly strong: boolean;
  readonly future: boolean;
};

export const FlowChart = ({
  points,
  projected = [],
}: {
  readonly points: readonly MonthPoint[];
  readonly projected?: readonly ProjectedMonth[];
}): React.ReactElement | null => {
  const container = useRef<HTMLDivElement>(null);
  const width = useElementWidth(container, 720);
  const hiddenValues = useValuesHidden();
  const [hover, setHover] = useState<number | null>(null);

  const selected = points.find((point) => point.selected);
  if (selected === undefined) return null;

  const slots: readonly Slot[] = [
    ...points.map((point): Slot => ({
      key: point.key,
      start: point.start,
      receitas: point.receitas,
      despesas: point.despesas,
      saldo: point.saldo,
      selected: point.selected,
      strong: point.selected && point.inProgress,
      future: false,
    })),
    ...projected.map((month): Slot => ({
      key: month.key,
      start: month.start,
      receitas: month.receitas,
      despesas: month.despesas,
      saldo: month.receitas - month.despesas,
      selected: false,
      strong: false,
      future: true,
    })),
  ];

  const compactChart = width < COMPACT_BELOW;
  const height = compactChart ? COMPACT_HEIGHT : HEIGHT;
  const svgWidth = Math.max(1, width - 40);
  const plotWidth = Math.max(1, svgWidth - MARGIN.left - MARGIN.right);
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const max = Math.max(1, ...slots.flatMap((slot) => [slot.receitas, slot.despesas]));
  const top = Math.ceil(max / 500_00) * 500_00;
  const slotWidth = plotWidth / slots.length;
  const bar = Math.max(2, Math.min(18, (slotWidth - 6) / 2));
  const y = (cents: number): number => plotHeight - (cents / top) * plotHeight;
  const hovered = hover === null ? null : (slots[hover] ?? null);
  const hasFuture = projected.length > 0;

  return (
    <div ref={container} className="relative px-5 pt-5 pb-4">
      <svg
        role="img"
        aria-label={`Receitas e despesas dos últimos 12 meses; ${formatMonthShort(selected.start)}: receitas ${formatBRL(selected.receitas)}, despesas ${formatBRL(selected.despesas)}${hasFuture ? `; mais ${projected.length} meses previstos` : ''}`}
        viewBox={`0 0 ${svgWidth} ${height}`}
        className="block w-full overflow-visible"
        style={{ height }}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <line
            x1={0}
            x2={plotWidth}
            y1={plotHeight}
            y2={plotHeight}
            className="stroke-line-2"
          />
          {slots.map((slot, index) => {
            const cx = index * slotWidth + slotWidth / 2;
            const dashed = slot.future
              ? { strokeDasharray: '3 2', strokeWidth: 1.25 }
              : {};
            return (
              <g
                key={`${slot.future ? 'f' : 'h'}-${slot.key}`}
                data-month={slot.key}
                data-strong={slot.strong ? 'true' : 'false'}
                data-future={slot.future ? 'true' : undefined}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={index * slotWidth}
                  y={0}
                  width={slotWidth}
                  height={plotHeight}
                  fill="transparent"
                />
                <rect
                  x={cx - bar - 1}
                  y={y(slot.receitas)}
                  width={bar}
                  height={plotHeight - y(slot.receitas)}
                  rx={2}
                  className={
                    slot.future ? 'fill-positive stroke-positive' : 'fill-positive'
                  }
                  opacity={slot.future ? 0.28 : slot.strong ? 1 : 0.6}
                  {...dashed}
                />
                <rect
                  x={cx + 1}
                  y={y(slot.despesas)}
                  width={bar}
                  height={plotHeight - y(slot.despesas)}
                  rx={2}
                  className={slot.future ? 'fill-ink-3 stroke-ink-3' : 'fill-ink-3'}
                  opacity={slot.future ? 0.28 : slot.strong ? 1 : 0.6}
                  {...dashed}
                />
                <text
                  x={cx}
                  y={plotHeight + 18}
                  textAnchor="middle"
                  className={
                    slot.selected
                      ? 'tabular fill-ink text-label font-semibold'
                      : 'tabular fill-ink-3 text-label'
                  }
                >
                  {compactChart && !slot.future && index % 2 === 0 && !slot.selected
                    ? ''
                    : formatMonthShort(slot.start)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <p className="tabular mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-3.5 bg-positive" />
          <span className="text-ink-2">Receitas</span>{' '}
          <strong className="font-semibold">
            {hiddenValues ? '•••' : roundedBRL(selected.receitas)}
          </strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-3.5 bg-ink-3" />
          <span className="text-ink-2">Despesas</span>{' '}
          <strong className="font-semibold">
            {hiddenValues ? '•••' : roundedBRL(selected.despesas)}
          </strong>
        </span>
        {hasFuture ? (
          <span className="inline-flex items-center gap-1.5 text-ink-3">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-3 rounded-xs border border-dashed border-ink-3 opacity-70"
            />
            Previsto
          </span>
        ) : null}
      </p>
      {hovered === null || hover === null ? null : (
        <div
          role="tooltip"
          className="tabular pointer-events-none absolute top-8 rounded-control border border-line-2 bg-panel px-2.5 py-1.5 text-xs shadow-panel"
          style={{
            left: `min(max(${MARGIN.left + hover * slotWidth + slotWidth}px, 8px), calc(100% - 11rem))`,
          }}
        >
          <div className="font-semibold">
            {formatMonthShort(hovered.start)}/{hovered.start.slice(0, 4)}
            {hovered.future ? (
              <span className="font-normal text-ink-3"> · previsto</span>
            ) : null}
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
