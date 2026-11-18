import {
  SkeletonBar,
  SkeletonChart,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonRegion,
  SkeletonStats,
  SkeletonTable,
} from '../../components/skeleton.js';
import { Panel } from '../../components/primitives.js';

/**
 * FIN-701 · Esqueleto de cada tela de Finanças, montado com as peças de
 * Investimentos: a forma é a da tela real, para nada pular quando ela chega.
 */

const Toolbar = (): React.ReactElement => (
  <div aria-hidden="true" className="flex items-center gap-2">
    <SkeletonBar className="h-8 w-64 max-w-full" />
    <SkeletonBar className="h-8 w-20" />
    <SkeletonBar className="h-8 w-20" />
  </div>
);

const Shell = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <SkeletonRegion label={label} className="flex flex-col gap-4 p-6">
    <SkeletonHeader />
    {children}
  </SkeletonRegion>
);

/** O cabeçalho da Visão geral: título à esquerda, escopo, período e ação à direita. */
const HomeHeader = (): React.ReactElement => (
  <div aria-hidden="true" className="flex flex-wrap items-start justify-between gap-3">
    <SkeletonHeader />
    <div className="flex items-center gap-2">
      <SkeletonBar className="h-8 w-56" />
      <SkeletonBar className="h-8 w-48" />
      <SkeletonBar className="h-8 w-8" />
      <SkeletonBar className="h-8 w-32" />
    </div>
  </div>
);

const ChartBlock = (): React.ReactElement => (
  <div className="flex flex-col gap-4">
    <div className="flex flex-col gap-2">
      <SkeletonBar className="h-2.5 w-44" />
      <SkeletonBar className="h-8 w-60" />
    </div>
    <SkeletonChart className="[&>span:first-child]:h-64" />
  </div>
);

/** Visão geral · Tudo (prancha 1.1): os mesmos painéis, na mesma grade. */
const TudoSkeleton = (): React.ReactElement => (
  <SkeletonRegion label="Carregando Visão geral" className="flex flex-col gap-4">
    <HomeHeader />
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <SkeletonPanel title="Patrimônio">
        <SkeletonTable rows={6} columns={3} />
      </SkeletonPanel>
      <SkeletonPanel title="Fluxo do mês">
        <SkeletonTable rows={5} columns={4} />
      </SkeletonPanel>
    </div>
    <SkeletonPanel title="Evolução do patrimônio">
      <ChartBlock />
    </SkeletonPanel>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <SkeletonPanel title="Alocação por classe">
        <SkeletonTable rows={4} columns={5} />
      </SkeletonPanel>
      <SkeletonPanel title="Objetivos">
        <SkeletonTable rows={2} columns={4} />
      </SkeletonPanel>
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <SkeletonPanel title="Próximas movimentações">
        <SkeletonTable rows={6} columns={4} />
      </SkeletonPanel>
      <div className="flex flex-col gap-4">
        <SkeletonPanel title="Faturas abertas">
          <SkeletonTable rows={3} columns={3} />
        </SkeletonPanel>
        <SkeletonPanel title="Contas">
          <SkeletonTable rows={3} columns={3} />
        </SkeletonPanel>
      </div>
    </div>
  </SkeletonRegion>
);

/** Visão geral · Fluxo (prancha 1.2). */
const FluxoSkeleton = (): React.ReactElement => (
  <SkeletonRegion label="Carregando Visão geral" className="flex flex-col gap-4">
    <HomeHeader />
    <Panel>
      <div className="p-4">
        <SkeletonStats count={5} />
      </div>
    </Panel>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <SkeletonPanel title="Saldo previsto em contas">
        <SkeletonChart className="[&>span:first-child]:h-64" />
      </SkeletonPanel>
      <SkeletonPanel title="Despesas por categoria">
        <SkeletonTable rows={7} columns={4} />
      </SkeletonPanel>
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <SkeletonPanel title="Próximas movimentações">
        <SkeletonTable rows={6} columns={4} />
      </SkeletonPanel>
      <div className="flex flex-col gap-4">
        <SkeletonPanel title="Faturas abertas">
          <SkeletonTable rows={3} columns={3} />
        </SkeletonPanel>
        <SkeletonPanel title="Aportes do mês">
          <SkeletonTable rows={3} columns={3} />
        </SkeletonPanel>
      </div>
    </div>
    <SkeletonPanel title="Receitas × despesas">
      <SkeletonChart />
    </SkeletonPanel>
  </SkeletonRegion>
);

/**
 * O esqueleto da Visão geral segue o escopo da URL (Tudo ou Fluxo); fora da
 * raiz, as telas de Finanças são "barra + tabela".
 */
export const OverviewSkeleton = (): React.ReactElement => {
  const location = globalThis.location as Location | undefined;
  if (location !== undefined && location.pathname !== '/') {
    return <TableScreenSkeleton label="Carregando" columns={6} />;
  }
  const scope =
    location === undefined ? null : new URLSearchParams(location.search).get('escopo');
  return scope === 'fluxo' ? <FluxoSkeleton /> : <TudoSkeleton />;
};

/** Telas "barra de ferramentas + tabela": Lançamentos, Recorrentes, Categorias, Contas, Cartões. */
export const TableScreenSkeleton = ({
  label,
  stats = 0,
  rows = 8,
  columns = 6,
}: {
  readonly label: string;
  readonly stats?: number;
  readonly rows?: number;
  readonly columns?: number;
}): React.ReactElement => (
  <Shell label={label}>
    {stats > 0 ? <SkeletonStats count={stats} /> : null}
    <Toolbar />
    <Panel>
      <SkeletonTable rows={rows} columns={columns} />
    </Panel>
  </Shell>
);
