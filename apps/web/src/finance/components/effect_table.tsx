import { formatBRL } from '../lib/format.js';
import type { EffectRow } from '../domain/effects.js';

/**
 * Prancha "Finanças · Modais": o bloco EFEITO · ANTES → DEPOIS. Diz o que muda
 * nos números se a pessoa salvar, antes de ela salvar. O "depois" é o que fica;
 * quando nada muda a linha some, para o bloco não repetir o óbvio.
 */
export const EffectTable = ({
  title = 'Efeito',
  rows,
}: {
  readonly title?: string;
  readonly rows: readonly EffectRow[];
}): React.ReactElement | null => {
  const changed = rows.filter((row) => row.before !== row.after);
  if (changed.length === 0) return null;
  return (
    <div role="group" aria-label={title} className="rounded-control border border-line">
      <div className="tabular flex items-center justify-between border-b border-line px-3 py-1.5 text-label tracking-[0.06em] text-ink-3 uppercase">
        <span>{title}</span>
        <span>Antes → depois</span>
      </div>
      <ul>
        {changed.map((row) => (
          <li
            key={`${row.label}-${row.hint ?? ''}`}
            className="flex items-baseline justify-between gap-4 border-t border-line px-3 py-2 text-[0.8125rem] first:border-t-0"
          >
            <span>
              {row.label}
              {row.hint === undefined ? null : (
                <span className="ml-1.5 text-xs text-ink-3">{row.hint}</span>
              )}
            </span>
            <span className="tabular whitespace-nowrap">
              <span className="text-ink-3">{formatBRL(row.before)}</span>
              <span aria-hidden="true" className="mx-1.5 text-ink-3">
                →
              </span>
              <span className="sr-only"> para </span>
              <strong className="font-semibold">{formatBRL(row.after)}</strong>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
