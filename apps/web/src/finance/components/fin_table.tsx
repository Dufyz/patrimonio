import { cn } from '../../lib/cn.js';

/**
 * FIN-004 · Os componentes únicos de tabela de Finanças.
 *
 * Uma linha por registro e sem quebra de linha. Cabeçalho em caixa alta e fonte
 * monoespaçada; valores alinhados à direita. Linhas de seção agrupam por dia,
 * tipo, categoria, conta, cartão ou bloco da fatura; linhas de subtotal e de
 * total têm destaque de fundo. Toda linha clicável muda de fundo no mouse e
 * mostra a mão.
 */

type Align = 'left' | 'right' | 'center';

const ALIGN: Readonly<Record<Align, string>> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export const FinTable = ({
  caption,
  fill = false,
  children,
}: {
  /** Nome acessível da tabela; não é exibido. */
  readonly caption: string;
  /**
   * Ocupa a altura que sobra no painel: com um `FillRow` entre as linhas e o
   * total, o total fica no pé do cartão e o vazio fica no meio, sem quebrar.
   */
  readonly fill?: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const table = (
    <table
      className={`w-full border-collapse text-cell whitespace-nowrap ${fill ? 'h-full' : ''}`}
    >
      <caption className="sr-only">{caption}</caption>
      {children}
    </table>
  );
  return fill ? <div className="min-h-0 flex-1">{table}</div> : table;
};

/** A linha que absorve a altura que sobra numa `FinTable` com `fill`. */
export const FillRow = ({
  colSpan,
}: {
  readonly colSpan: number;
}): React.ReactElement => (
  <tr aria-hidden="true" className="h-full">
    <td colSpan={colSpan} />
  </tr>
);

export const THead = ({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <thead>
    <tr className="border-b border-line">{children}</tr>
  </thead>
);

export const Th = ({
  align = 'left',
  className,
  children,
}: {
  readonly align?: Align;
  readonly className?: string | undefined;
  readonly children?: React.ReactNode;
}): React.ReactElement => (
  <th
    scope="col"
    className={cn(
      'tabular px-3 py-2.5 text-label font-normal tracking-[0.08em] text-ink-3 uppercase',
      ALIGN[align],
      className,
    )}
  >
    {children}
  </th>
);

export const Td = ({
  align = 'left',
  numeric = false,
  className,
  colSpan,
  children,
}: {
  readonly align?: Align;
  /** Valor numérico: mono, alinhado à direita. */
  readonly numeric?: boolean;
  readonly className?: string | undefined;
  readonly colSpan?: number | undefined;
  readonly children?: React.ReactNode;
}): React.ReactElement => (
  <td
    {...(colSpan === undefined ? {} : { colSpan })}
    className={cn(
      'px-3 py-[var(--row-pad)]',
      numeric ? 'tabular text-right' : ALIGN[align],
      className,
    )}
  >
    {children}
  </td>
);

export const Row = ({
  onClick,
  onToggle,
  onActivate,
  onEscape,
  selected = false,
  muted = false,
  label,
  className,
  children,
}: {
  readonly onClick?: (() => void) | undefined;
  /** FIN-705 · `Espaço` seleciona a linha. */
  readonly onToggle?: (() => void) | undefined;
  /** FIN-705 · `Enter` abre ou edita, nas linhas sem clique. */
  readonly onActivate?: (() => void) | undefined;
  /** FIN-705 · `Esc` limpa a seleção. */
  readonly onEscape?: (() => void) | undefined;
  readonly selected?: boolean;
  /** Linha inativa, esmaecida. */
  readonly muted?: boolean;
  readonly label?: string | undefined;
  readonly className?: string | undefined;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <tr
    {...(onClick === undefined && onToggle === undefined && onActivate === undefined
      ? {}
      : {
          ...(onClick === undefined ? {} : { onClick }),
          tabIndex: 0,
          'data-navigable': true,
          ...(onClick === undefined ? {} : { 'data-clickable': true }),
          onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const rows = Array.from(
                event.currentTarget
                  .closest('table')
                  ?.querySelectorAll<HTMLTableRowElement>('tr[data-navigable]') ?? [],
              );
              const at = rows.indexOf(event.currentTarget);
              rows[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
            } else if (event.key === 'Enter') {
              const act = onClick ?? onActivate;
              if (act !== undefined) {
                event.preventDefault();
                act();
              }
            } else if (event.key === ' ' && onToggle !== undefined) {
              event.preventDefault();
              onToggle();
            } else if (event.key === 'Escape' && onEscape !== undefined) {
              onEscape();
            }
          },
        })}
    {...(label === undefined ? {} : { 'aria-label': label })}
    aria-selected={selected ? true : undefined}
    className={cn(
      'border-b border-line last:border-b-0',
      onClick !== undefined && 'cursor-pointer hover:bg-panel-2',
      'focus-visible:bg-panel-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
      selected && 'bg-accent-soft hover:bg-accent-soft',
      muted && 'opacity-55',
      className,
    )}
  >
    {children}
  </tr>
);

/** A linha de seção: rótulo à esquerda, total ou resumo à direita. */
export const SectionRow = ({
  colSpan,
  label,
  summary,
  strongSummary = false,
}: {
  readonly colSpan: number;
  readonly label: React.ReactNode;
  readonly summary?: React.ReactNode;
  /** O total do bloco em destaque (mono, forte), como em Cartões. */
  readonly strongSummary?: boolean;
}): React.ReactElement => (
  <tr className="border-y border-line bg-panel-2">
    <td colSpan={colSpan} className="px-3 py-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[0.8125rem] font-semibold">{label}</span>
        {summary === undefined ? null : (
          <span
            className={
              strongSummary
                ? 'tabular text-[0.8125rem] font-semibold'
                : 'tabular text-xs text-ink-3'
            }
          >
            {summary}
          </span>
        )}
      </div>
    </td>
  </tr>
);

/** Subtotal de um bloco ou total de uma tabela, com destaque de fundo. */
export const SummaryRow = ({
  kind = 'subtotal',
  children,
}: {
  readonly kind?: 'subtotal' | 'total';
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <tr
    data-summary={kind}
    className={cn(
      'border-y border-line bg-panel-2 font-semibold',
      kind === 'total' && 'border-t-line-2',
    )}
  >
    {children}
  </tr>
);

/** O marcador de categoria: quadrado na cor da categoria e o nome. */
export const CategoryMarker = ({
  color,
  name,
}: {
  /** Valor de cor CSS, normalmente `var(--color-cat-...)`. */
  readonly color: string;
  readonly name: string;
}): React.ReactElement => (
  <span className="inline-flex items-center gap-2">
    <span
      aria-hidden="true"
      data-testid="category-swatch"
      className="inline-block size-2.5 shrink-0 rounded-[2px]"
      style={{ backgroundColor: color }}
    />
    <span>{name}</span>
  </span>
);
