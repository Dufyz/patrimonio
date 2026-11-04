import { Component } from 'react';

import { Button } from '../../components/primitives.js';
import {
  SkeletonBar,
  SkeletonHeader,
  SkeletonRegion,
  SkeletonTable,
} from '../../components/skeleton.js';

/**
 * FIN-701 · Os três estados que toda tela comunica: carregando, vazio e erro.
 * Nenhum esqueleto carrega número (um "0,00" de mentira seria lido como saldo).
 */

/** A faixa de indicadores: cinco células, na altura das reais. */
export const StripSkeleton = (): React.ReactElement => (
  <div
    aria-hidden="true"
    className="grid grid-cols-2 divide-x divide-line overflow-hidden rounded-panel border border-line bg-panel md:grid-cols-5"
  >
    {Array.from({ length: 5 }, (_, index) => (
      <div key={index} className="flex flex-col gap-2 px-6 py-4">
        <SkeletonBar className="h-2.5 w-16" />
        <SkeletonBar className="h-6 w-28" />
        <SkeletonBar className="h-2.5 w-20" />
      </div>
    ))}
  </div>
);

/** Um gráfico: a moldura e as barras, sem valores. */
export const ChartSkeleton = (): React.ReactElement => (
  <div aria-hidden="true" className="flex h-[220px] items-end gap-3 px-5 pb-6">
    {Array.from({ length: 12 }, (_, index) => (
      <SkeletonBar
        key={index}
        className="flex-1"
        // alturas fixas e diferentes: parece gráfico, não régua
      />
    ))}
  </div>
);

/** Uma tela inteira enquanto o código dela chega. */
export const FinanceLoading = ({
  label = 'Carregando Finanças',
}: {
  readonly label?: string;
}): React.ReactElement => (
  <SkeletonRegion label={label} className="flex flex-col gap-4 p-6">
    <SkeletonHeader />
    <StripSkeleton />
    <div className="rounded-panel border border-line bg-panel">
      <SkeletonTable rows={6} columns={5} />
    </div>
  </SkeletonRegion>
);

/** Um painel carregando: forma de tabela, com o nome para o leitor de tela. */
export const PanelLoading = ({
  label,
  rows = 5,
  columns = 5,
}: {
  readonly label: string;
  readonly rows?: number;
  readonly columns?: number;
}): React.ReactElement => (
  <SkeletonRegion label={label} className="rounded-panel border border-line bg-panel">
    <SkeletonTable rows={rows} columns={columns} />
  </SkeletonRegion>
);

/** Vazio: mensagem curta e a ação principal da tela. */
export const EmptyPanel = ({
  message,
  actionLabel,
  onAction,
}: {
  readonly message: string;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
}): React.ReactElement => (
  <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
    <p className="text-[0.8125rem] text-ink-3">{message}</p>
    {actionLabel === undefined || onAction === undefined ? null : (
      <Button variant="primary" onClick={onAction}>
        {actionLabel}
      </Button>
    )}
  </div>
);

/** Erro: a causa, quando conhecida, e "Tentar novamente". */
export const PanelError = ({
  title,
  cause,
  onRetry,
}: {
  readonly title: string;
  readonly cause?: string | undefined;
  readonly onRetry: () => void;
}): React.ReactElement => (
  <div
    role="alert"
    className="flex flex-col items-start gap-2 rounded-panel border border-negative/40 bg-panel px-5 py-4"
  >
    <p className="text-[0.875rem] font-semibold">{title}</p>
    <p className="text-[0.8125rem] text-ink-3">
      {cause === undefined || cause === ''
        ? 'Algo deu errado ao montar este painel.'
        : cause}
    </p>
    <Button onClick={onRetry}>Tentar novamente</Button>
  </div>
);

type BoundaryProps = {
  readonly title: string;
  readonly children: React.ReactNode;
};
type BoundaryState = { readonly error: Error | null };

/**
 * Um painel que falha não derruba a tela: o erro fica contido nele, com a causa
 * e a ação de tentar de novo.
 */
export class PanelBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override render(): React.ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <PanelError
        title={`Não foi possível carregar ${this.props.title}`}
        cause={error.message}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}
