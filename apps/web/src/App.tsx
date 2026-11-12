import { lazy, Suspense, useMemo } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  BrowserRouter,
} from 'react-router';

import { AppLayout } from './app_layout.js';
import { PortfoliosProvider, usePortfolios } from './components/portfolios_provider.js';
import { SkeletonRegion, SkeletonTable } from './components/skeleton.js';
import { WelcomeScreen } from './views/welcome.js';
import { ShortcutProvider, useShortcuts } from './components/shortcuts.js';
import { screensForScope } from './lib/investment_screens.js';
import { routes } from './lib/routes.js';
import { ALL_SCOPE, portfolioIdForScope, scopeForPortfolioId } from './lib/scope.js';
import { FinanceLoading } from './finance/components/states.js';
import { AssetScreen } from './views/asset.js';
import { Gallery } from './views/gallery.js';
import { OverviewScreen } from './views/overview.js';
import { GoalsScreen } from './views/goals.js';
import { GoalsOverviewScreen } from './views/goals_overview.js';
import { PositionsScreen } from './views/positions.js';
import { ProjectionScreen } from './views/projection.js';
import { SettingsScreen } from './views/settings/index.js';
import { StatementScreen } from './views/statement.js';
import { StrategyScreen } from './views/strategy.js';

/**
 * NAV-001 · As rotas do app.
 *
 * `/geral`, `/financas/<tela>`, `/investimentos/<escopo>/<tela>` e
 * `/configuracoes`, todas dentro da casca única (`AppLayout`). A galeria do
 * design system continua em `/galeria`, fora dela.
 *
 * O escopo e a tela vivem na URL, não em estado. Trocar de carteira mantém a
 * tela atual, porque quem troca está comparando, não recomeçando.
 */

export const App = (): React.ReactElement => (
  <BrowserRouter>
    <ShortcutProvider>
      <PortfoliosProvider>
        <Workspace />
      </PortfoliosProvider>
    </ShortcutProvider>
  </BrowserRouter>
);

const FinanceHost = lazy(() =>
  import('./finance/finance_app.js').then((module) => ({ default: module.FinanceHost })),
);
const FinanceRoutes = lazy(() =>
  import('./finance/finance_app.js').then((module) => ({
    default: module.FinanceRoutes,
  })),
);
const GeralScreen = lazy(() =>
  import('./views/geral/geral_screen.js').then((module) => ({
    default: module.GeralScreen,
  })),
);

const Workspace = (): React.ReactElement => (
  <Routes>
    <Route path="/galeria" element={<Gallery />} />
    <Route element={<AppLayout />}>
      {/* Geral e Finanças leem os mesmos dados de Finanças: um provedor só. */}
      <Route
        element={
          <Suspense fallback={<FinanceLoading />}>
            <FinanceHost />
          </Suspense>
        }
      >
        <Route path="/geral" element={<GeralScreen />} />
        <Route path="/financas/*" element={<FinanceRoutes />} />
      </Route>
      {/* A página do ativo é uma tela dentro do escopo, e não uma tela da barra
          lateral: ela pertence ao papel, e o papel pertence à carteira. Por isso
          ela mora sob o escopo e mantém Posições destacada na navegação. */}
      <Route path="/investimentos/:scope/ativo/:asset" element={<Workbench />} />
      <Route path="/investimentos/:scope/:screen" element={<Workbench />} />
      <Route
        path="/investimentos/:scope"
        element={<Navigate to={routes.investments(ALL_SCOPE)} replace />}
      />
      <Route
        path="/investimentos"
        element={<Navigate to={routes.investments(ALL_SCOPE)} replace />}
      />
      {/* Configurações vale para o app inteiro. */}
      <Route path="/configuracoes" element={<SettingsScreen />} />
    </Route>
    <Route path="*" element={<Navigate to={routes.home()} replace />} />
  </Routes>
);

const Workbench = (): React.ReactElement => {
  const params = useParams();
  const scope = params['scope'] ?? ALL_SCOPE;
  const screen = params['screen'] ?? 'visao-geral';
  const asset = params['asset'];
  const navigate = useNavigate();

  const { portfolios, values, slugs, loaded, failed, reload } = usePortfolios();

  const allPortfolios = scope === ALL_SCOPE;
  const portfolioId = allPortfolios ? null : portfolioIdForScope(scope, slugs);

  // Em "Todas as carteiras" só existem as telas que somam carteiras. As demais
  // (estratégia) medem uma carteira, e a página do ativo pertence ao papel
  // dentro de uma carteira: abrir uma delas aqui cai na tela mais próxima.
  const screens = useMemo(() => screensForScope(allPortfolios), [allPortfolios]);

  // Com um ativo na URL, a tela ativa continua sendo Posições: a página do
  // ativo foi aberta de lá, e é para lá que a trilha volta.
  const current =
    asset === undefined
      ? (screens.find((item) => item.id === screen) ?? screens[0])
      : screens.find((item) => item.id === 'posicoes');
  const scopeLabel = allPortfolios
    ? 'Todas as carteiras'
    : (portfolios.find((item) => item.id === portfolioId)?.name ?? 'Carteira');

  const shortcuts = useMemo(
    () => ({
      ...Object.fromEntries(
        screens.map((item) => [
          `go_${item.shortcut}`,
          () => navigate(routes.investments(scope, item.id)),
        ]),
      ),
    }),
    [navigate, scope, screens],
  );
  useShortcuts(shortcuts);

  /**
   * "Ver lançamentos" de um ativo abre o extrato todo, e não os últimos três
   * meses: quem pergunta pelos lançamentos de um ativo quer o histórico dele.
   */
  const openStatement = (search: string): void => {
    void navigate(
      `${routes.investments(scope, 'movimentacoes')}?${new URLSearchParams({ busca: search, periodo: 'inicio' }).toString()}`,
    );
  };

  /**
   * Abre a página do ativo na carteira da linha. Em "Todas as carteiras" cada
   * linha de Posições e de Movimentações sabe a sua; a que não sabe (posição
   * encerrada, que soma carteiras) não abre.
   */
  const openAssetIn = (slug: string, rowPortfolioId: string | null): void => {
    const target = rowPortfolioId ?? portfolioId;
    if (target === null) return;

    const targetScope = scopeForPortfolioId(target, slugs);
    if (targetScope !== null) void navigate(routes.asset(targetScope, slug));
  };

  if (!loaded) return <WorkbenchSkeleton />;

  if (failed !== null) {
    return (
      <div role="alert" className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-panel-title font-semibold text-negative">
          Não foi possível carregar as carteiras
        </h1>
        <p className="mt-2 text-[0.8125rem] text-ink-2">{failed.message}</p>
        <button
          type="button"
          className="mt-4 h-control cursor-pointer rounded-control border border-line px-3 text-[0.8125rem] hover:bg-panel-2"
          onClick={reload}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (portfolios[0] === undefined) {
    return <WelcomeScreen onOpenSettings={() => navigate(routes.settings())} />;
  }
  if (!allPortfolios && portfolioId === null) {
    return <Navigate to={routes.investments(ALL_SCOPE)} replace />;
  }
  if (allPortfolios && asset !== undefined) {
    return <Navigate to={routes.investments(ALL_SCOPE, 'posicoes')} replace />;
  }
  if (allPortfolios && !screens.some((item) => item.id === screen)) {
    return <Navigate to={routes.investments(ALL_SCOPE)} replace />;
  }
  // Tela desconhecida em uma carteira (ou que não existe mais): Visão geral.
  if (asset === undefined && !screens.some((item) => item.id === screen)) {
    return <Navigate to={routes.investments(scope)} replace />;
  }

  return (
    <>
      {asset !== undefined ? (
        portfolioId === null ? null : (
          <AssetScreen
            assetRef={asset}
            portfolioId={portfolioId}
            scopeLabel={scopeLabel}
            onBack={() => navigate(routes.investments(scope, 'posicoes'))}
            onOpenStatement={openStatement}
          />
        )
      ) : current?.id === 'visao-geral' ? (
        <OverviewScreen
          portfolioId={portfolioId}
          {...(allPortfolios
            ? {}
            : { onOpenAsset: (slug: string) => navigate(routes.asset(scope, slug)) })}
          onOpenScreen={(path) => navigate(routes.investments(scope, path))}
          onOpenPortfolio={(id) => {
            const target = scopeForPortfolioId(id, slugs);
            if (target !== null) navigate(routes.investments(target));
          }}
        />
      ) : current?.id === 'posicoes' ? (
        <PositionsScreen
          portfolioId={portfolioId}
          scopeLabel={scopeLabel}
          onOpenAsset={openAssetIn}
          onOpenStatement={openStatement}
        />
      ) : current?.id === 'movimentacoes' ? (
        <StatementScreen
          portfolioId={portfolioId}
          scopeLabel={scopeLabel}
          portfolios={portfolios}
          onOpenAsset={openAssetIn}
        />
      ) : current?.id === 'estrategia' ? (
        portfolioId === null ? null : (
          <StrategyScreen portfolioId={portfolioId} />
        )
      ) : current?.id === 'objetivos' ? (
        portfolioId === null ? (
          <GoalsOverviewScreen
            onOpenPortfolio={(id) => {
              const target = scopeForPortfolioId(id, slugs);
              if (target !== null) navigate(routes.investments(target, 'objetivos'));
            }}
          />
        ) : (
          <GoalsScreen portfolioId={portfolioId} scopeLabel={scopeLabel} />
        )
      ) : current?.id === 'projecao' ? (
        <ProjectionScreen
          portfolios={portfolios}
          portfolioId={portfolioId}
          values={values}
        />
      ) : null}
    </>
  );
};

/** O corpo em cinza, enquanto a lista de carteiras não chegou. */
const WorkbenchSkeleton = (): React.ReactElement => (
  <SkeletonRegion label="Carregando">
    <SkeletonTable rows={8} columns={5} />
  </SkeletonRegion>
);
