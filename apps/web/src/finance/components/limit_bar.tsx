import { cn } from '../../lib/cn.js';
import { limitTone } from '../lib/limit.js';
import type { LimitTone } from '../lib/limit.js';

/**
 * FIN-004 · A barra de consumo do limite do cartão, com o percentual ao lado em
 * fonte monoespaçada. Verde, âmbar e vermelho por faixa.
 */

const FILL: Readonly<Record<LimitTone, string>> = {
  ok: 'bg-positive',
  warn: 'bg-attention',
  high: 'bg-negative',
};

export const formatPercentValue = (percent: number): string =>
  `${percent.toFixed(1).replace('.', ',')}%`;

export const LimitBar = ({
  percent,
}: {
  readonly percent: number;
}): React.ReactElement => {
  const tone = limitTone(percent);
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        role="progressbar"
        aria-label="Limite usado"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, percent)}
        className="relative h-1.5 w-28 overflow-hidden rounded-full bg-line"
      >
        <span
          data-tone={tone}
          className={cn('absolute inset-y-0 left-0 rounded-full', FILL[tone])}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </span>
      <span className="tabular w-12 text-right text-[0.8125rem]">
        {formatPercentValue(percent)}
      </span>
    </span>
  );
};
