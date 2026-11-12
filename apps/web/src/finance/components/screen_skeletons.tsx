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

export const OverviewSkeleton = (): React.ReactElement => (
  <Shell label="Carregando Visão geral">
    <Panel>
      <div className="p-4">
        <SkeletonStats count={5} />
      </div>
    </Panel>
    <SkeletonPanel title="Receitas × despesas">
      <SkeletonChart />
    </SkeletonPanel>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <SkeletonTable rows={6} columns={4} />
      </Panel>
      <Panel>
        <SkeletonTable rows={6} columns={3} />
      </Panel>
    </div>
  </Shell>
);

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

/** Extrato da conta e Fatura do cartão: totais, gráfico e tabela. */
export const DetailSkeleton = ({
  label,
}: {
  readonly label: string;
}): React.ReactElement => (
  <Shell label={label}>
    <SkeletonStats count={4} />
    <SkeletonPanel>
      <SkeletonChart />
    </SkeletonPanel>
    <Toolbar />
    <Panel>
      <SkeletonTable rows={8} columns={6} />
    </Panel>
  </Shell>
);

export const SettingsSkeleton = (): React.ReactElement => (
  <Shell label="Carregando Configurações">
    <SkeletonPanel title="Preferências" />
    <SkeletonPanel title="Dados" />
  </Shell>
);
