import { cn } from '../../lib/cn.js';

/**
 * FIN-004 · A faixa de indicadores: poucas células, cada uma com rótulo em caixa
 * alta, valor grande e legenda.
 */

export type StatCell = {
  readonly id: string;
  readonly label: string;
  readonly value: React.ReactNode;
  readonly caption?: React.ReactNode;
};

export const StatStrip = ({
  cells,
  label,
  bare = false,
}: {
  readonly cells: readonly StatCell[];
  /** Nome acessível da região. */
  readonly label: string;
  /** Sem moldura própria: a faixa mora dentro de um `Panel`. */
  readonly bare?: boolean;
}): React.ReactElement => (
  <section
    aria-label={label}
    className={
      bare ? '' : 'overflow-hidden rounded-panel border border-line bg-panel shadow-panel'
    }
  >
    <dl
      className={cn(
        'grid divide-line max-md:grid-cols-2 max-md:[&>div]:border-b max-md:[&>div]:border-line',
        '[&>div:not(:first-child)]:border-l [&>div]:border-line',
        bare && 'max-md:[&>div:nth-child(odd)]:border-l-0',
      )}
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells.map((cell) => (
        <div key={cell.id} className="flex min-w-0 flex-col gap-1.5 px-6 py-4">
          <dt className="tabular text-label tracking-[0.08em] text-ink-3 uppercase">
            {cell.label}
          </dt>
          <dd className="tabular text-screen-title leading-none font-semibold tracking-[-0.02em]">
            {cell.value}
          </dd>
          {cell.caption === undefined ? null : (
            <dd className="text-[0.8125rem] text-ink-3">{cell.caption}</dd>
          )}
        </div>
      ))}
    </dl>
  </section>
);
