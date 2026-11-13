import type { GoalResource } from '@patrimonio/contracts';

import { STATUS_LABEL, barState } from '../lib/goals.js';

/**
 * CMP-10 · O anel de progresso do objetivo: o único gráfico circular do app.
 *
 * O percentual atingido fica no centro, e a marca é onde o objetivo deveria
 * estar hoje. A situação vem em texto ao lado — a cor nunca é o único sinal —,
 * e o anel inteiro é uma imagem com a descrição completa para leitor de tela.
 */
const SIZE = 96;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/** Ponto do anel para uma fração, começando às 12h e girando no sentido horário. */
const pointAt = (fraction: number, radius: number): { x: number; y: number } => {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return {
    x: SIZE / 2 + radius * Math.cos(angle),
    y: SIZE / 2 + radius * Math.sin(angle),
  };
};

export type ProgressRingProps = {
  readonly status: GoalResource['status'];
  /** Percentual atingido, 0–100 (string decimal do servidor). */
  readonly progressPct: string;
  /** Onde deveria estar hoje. Nulo sem ponto de partida: o anel fica sem marca. */
  readonly expectedPct: string | null;
};

export const ProgressRing = ({
  status,
  progressPct,
  expectedPct,
}: ProgressRingProps): React.ReactElement => {
  const progress = clamp(Number(progressPct));
  const expected = expectedPct === null ? null : clamp(Number(expectedPct));
  const state = barState(status);
  const label = STATUS_LABEL[status];

  const mark =
    expected === null
      ? null
      : {
          from: pointAt(expected / 100, RADIUS - STROKE / 2 - 2),
          to: pointAt(expected / 100, RADIUS + STROKE / 2 + 2),
        };

  return (
    <div className="flex items-center gap-4">
      <svg
        role="img"
        aria-label={`${progress.toFixed(1)}% atingido. ${label}.${
          expected === null ? '' : ` Esperado hoje: ${expected.toFixed(1)}%.`
        }`}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shrink-0"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-panel-2)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={state === 'reached' ? 'var(--color-positive)' : 'var(--color-accent)'}
          strokeWidth={STROKE}
          strokeLinecap="butt"
          strokeDasharray={`${(CIRCUMFERENCE * progress) / 100} ${CIRCUMFERENCE}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
        {mark === null ? null : (
          <line
            data-testid="ring-mark"
            x1={mark.from.x}
            y1={mark.from.y}
            x2={mark.to.x}
            y2={mark.to.y}
            stroke="var(--color-ink)"
            strokeWidth={2}
          />
        )}
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="tabular fill-ink text-[1.125rem] font-semibold"
        >
          {progress.toFixed(1).replace('.', ',')}%
        </text>
      </svg>

      <div className="flex flex-col gap-0.5 text-[0.8125rem]">
        <strong className="font-semibold">{label}</strong>
        {expected === null ? null : (
          <span className="tabular text-ink-3">
            esperado hoje {expected.toFixed(1).replace('.', ',')}%
          </span>
        )}
      </div>
    </div>
  );
};
