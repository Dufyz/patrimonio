import { cn } from '../../lib/cn.js';

/**
 * FIN-004 · Etiquetas.
 *
 * Etiqueta de situação: ponto colorido e texto (prevista, aberta, fechada,
 * paga). O estado nunca depende só da cor — o texto está sempre lá.
 * Etiqueta de natureza: só contorno (recorrente, transferência, fatura,
 * devolução, desconto, parcela, 2 pagamentos). "previsto" usa contorno
 * tracejado.
 */

export type StatusKind = 'prevista' | 'aberta' | 'fechada' | 'paga';

const STATUS_DOT: Readonly<Record<StatusKind, string>> = {
  prevista: 'bg-ink-3',
  aberta: 'bg-positive',
  fechada: 'bg-attention',
  paga: 'bg-accent',
};

export const StatusTag = ({
  status,
  label,
}: {
  readonly status: StatusKind;
  /** Sobrescreve o texto, como "fecha em 28/10". */
  readonly label?: string | undefined;
}): React.ReactElement => (
  <span className="inline-flex items-center gap-1.5 text-[0.8125rem]">
    <span
      aria-hidden="true"
      data-status={status}
      className={cn('inline-block size-2 rounded-full', STATUS_DOT[status])}
    />
    {label ?? status}
  </span>
);

export type NatureKind =
  | 'previsto'
  | 'recorrente'
  | 'transferência'
  | 'fatura'
  | 'devolução'
  | 'estorno'
  | 'desconto'
  | 'cashback'
  | 'crédito'
  | 'juros'
  | 'multa'
  | 'IOF'
  | '2 pagamentos'
  | (string & {});

/** Etiquetas que repetem ou preveem: levam a seta circular da prancha. */
const WITH_GLYPH: ReadonlySet<string> = new Set(['previsto', 'recorrente']);

export const NatureTag = ({
  kind,
  children,
}: {
  readonly kind: NatureKind;
  readonly children?: React.ReactNode;
}): React.ReactElement => (
  <span
    data-nature={kind}
    className={cn(
      'tabular inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-px text-xs leading-[1.3] text-ink-2',
      kind === 'previsto' ? 'border-dashed border-line-2' : 'border-line-2',
    )}
  >
    {WITH_GLYPH.has(kind) ? <span aria-hidden="true">↻</span> : null}
    {children ?? kind}
  </span>
);
