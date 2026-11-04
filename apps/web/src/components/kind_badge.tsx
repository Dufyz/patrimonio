/**
 * A pastilha do tipo de lançamento (prancha 03): Compra em azul, Venda em
 * âmbar, Provento em verde, o resto neutro. É a mesma em Movimentações e no
 * Histórico do ativo.
 */
const PILL: Readonly<Record<string, string>> = {
  buy: 'bg-accent-soft text-accent',
  sell: 'bg-attention-soft text-attention',
  payout: 'bg-positive-soft text-positive',
};

export const KindBadge = ({
  kind,
  children,
}: {
  readonly kind: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <span
    className={`inline-flex items-center rounded-[4px] px-2 py-0.5 text-[0.71875rem] font-medium ${PILL[kind] ?? 'bg-panel-2 text-ink-2'}`}
  >
    {children}
  </span>
);
