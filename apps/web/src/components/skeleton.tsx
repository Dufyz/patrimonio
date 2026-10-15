import { cn } from '../lib/cn.js';
import { Panel } from './primitives.js';

/**
 * O que aparece enquanto a `api` não respondeu.
 *
 * Um skeleton tem a forma do que vai chegar — cabeçalho, linhas de tabela,
 * painéis —, para a página não mudar de tamanho quando o dado chega. Ele nunca
 * carrega número: um "0,00" de mentira num esqueleto financeiro seria lido como
 * saldo. A animação respeita `prefers-reduced-motion`.
 *
 * Todo esqueleto é `aria-busy` e traz um texto só para leitor de tela, porque a
 * forma cinza não diz nada a quem não a enxerga.
 */

/** Uma barra cinza. A largura e a altura vêm de quem usa. */
export const SkeletonBar = ({
  className,
}: {
  readonly className?: string | undefined;
}): React.ReactElement => (
  <span
    aria-hidden="true"
    className={cn(
      'block h-3 rounded-control bg-panel-2 motion-safe:animate-pulse',
      className,
    )}
  />
);

/** O invólucro que marca a região como ocupada e diz o que está carregando. */
export const SkeletonRegion = ({
  label,
  className,
  children,
}: {
  /** Lido por leitor de tela: "Carregando a visão geral". */
  readonly label: string;
  readonly className?: string | undefined;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <div role="status" aria-busy="true" className={className}>
    <span className="sr-only">{label}</span>
    {children}
  </div>
);

/** Linhas de texto de larguras diferentes, para não parecer uma régua. */
const LINE_WIDTHS = ['w-3/4', 'w-full', 'w-2/3', 'w-5/6', 'w-1/2'] as const;

export const SkeletonLines = ({
  lines = 3,
  className,
}: {
  readonly lines?: number;
  readonly className?: string | undefined;
}): React.ReactElement => (
  <div aria-hidden="true" className={cn('flex flex-col gap-2.5', className)}>
    {Array.from({ length: lines }, (_, index) => (
      <SkeletonBar key={index} className={LINE_WIDTHS[index % LINE_WIDTHS.length]} />
    ))}
  </div>
);

/** O título da tela e a linha de apoio embaixo dele. */
export const SkeletonHeader = (): React.ReactElement => (
  <div aria-hidden="true" className="flex flex-col gap-2">
    <SkeletonBar className="h-6 w-48" />
    <SkeletonBar className="h-3 w-72 max-w-full" />
  </div>
);

/** Uma tabela: cabeçalho e N linhas, com a primeira coluna mais larga. */
export const SkeletonTable = ({
  rows = 6,
  columns = 5,
  className,
}: {
  readonly rows?: number;
  readonly columns?: number;
  readonly className?: string | undefined;
}): React.ReactElement => (
  <div aria-hidden="true" className={cn('flex flex-col', className)}>
    <div className="flex gap-4 border-b border-line px-4 py-3">
      {Array.from({ length: columns }, (_, column) => (
        <SkeletonBar
          key={column}
          className={cn('h-2.5', column === 0 ? 'flex-[2]' : 'flex-1')}
        />
      ))}
    </div>
    {Array.from({ length: rows }, (_, row) => (
      <div
        key={row}
        className="flex gap-4 border-t border-line px-4 py-3.5 first:border-t-0"
      >
        {Array.from({ length: columns }, (_, column) => (
          <SkeletonBar key={column} className={column === 0 ? 'flex-[2]' : 'flex-1'} />
        ))}
      </div>
    ))}
  </div>
);

/** Um painel com título e conteúdo cinza, no lugar de um painel de verdade. */
export const SkeletonPanel = ({
  title,
  children,
  className,
}: {
  readonly title?: string | undefined;
  readonly children?: React.ReactNode;
  readonly className?: string | undefined;
}): React.ReactElement => (
  <Panel
    {...(title === undefined ? {} : { title })}
    {...(className === undefined ? {} : { className })}
  >
    <div aria-hidden="true" className="p-4">
      {children ?? <SkeletonLines lines={4} />}
    </div>
  </Panel>
);

/** Uma faixa de totais: rótulo pequeno e valor grande, em colunas. */
export const SkeletonStats = ({
  count = 4,
}: {
  readonly count?: number;
}): React.ReactElement => (
  <div aria-hidden="true" className="flex flex-wrap gap-x-10 gap-y-3">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="flex flex-col gap-2">
        <SkeletonBar className="h-2.5 w-20" />
        <SkeletonBar className="h-5 w-32" />
      </div>
    ))}
  </div>
);

/** Um gráfico: a área e o eixo de baixo. */
export const SkeletonChart = ({
  className,
}: {
  readonly className?: string | undefined;
}): React.ReactElement => (
  <div aria-hidden="true" className={cn('flex flex-col gap-3', className)}>
    <SkeletonBar className="h-40 w-full" />
    <div className="flex justify-between">
      <SkeletonBar className="h-2.5 w-12" />
      <SkeletonBar className="h-2.5 w-12" />
      <SkeletonBar className="h-2.5 w-12" />
      <SkeletonBar className="h-2.5 w-12" />
    </div>
  </div>
);

/**
 * A tela inteira: título, uma faixa de totais e uma tabela. Serve de padrão para
 * as telas cuja forma é "totais + tabela" (Posições, Movimentações).
 */
export const ScreenSkeleton = ({
  label,
  stats = 4,
  rows = 8,
  columns = 6,
}: {
  readonly label: string;
  readonly stats?: number;
  readonly rows?: number;
  readonly columns?: number;
}): React.ReactElement => (
  <SkeletonRegion label={label} className="flex flex-col gap-4">
    <SkeletonHeader />
    <SkeletonStats count={stats} />
    <Panel>
      <SkeletonTable rows={rows} columns={columns} />
    </Panel>
  </SkeletonRegion>
);
