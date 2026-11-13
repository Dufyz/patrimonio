import { InvoiceScreen } from './views/cards/invoice_screen.js';
import { CardScreen } from './views/cards/card_screen.js';
import { CardsScreen } from './views/cards/cards_screen.js';
import { AccountsScreen } from './views/accounts/accounts_screen.js';
import { AccountStatementScreen } from './views/accounts/statement_screen.js';
import { LedgerScreen } from './views/ledger/ledger_screen.js';
import { lazy, Suspense, useMemo } from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  BrowserRouter,
} from 'react-router';

import { AppLayout } from './app_layout.js';
import { PortfoliosProvider, usePortfolios } from './components/portfolios_provider.js';
import { SkeletonRegion, SkeletonTable } from './components/skeleton.js';
import { WelcomeScreen } from './views/welcome.js';
import { ShortcutProvider, useShortcuts } from './components/shortcuts.js';
import { routableScreens, screensForScope } from './lib/investment_screens.js';
import { placeForPath, routes } from './lib/routes.js';
import { ALL_SCOPE, portfolioIdForScope, scopeForPortfolioId } from './lib/scope.js';
import { FinanceLoading } from './finance/components/states.js';
import {
  FinanceHost,
  FinanceOverview,
  financeScreenRoutes,
} from './finance/finance_app.js';
import { OverviewSkeleton } from './finance/components/screen_skeletons.js';
import { AssetScreen } from './views/asset.js';
import { Gallery } from './views/gallery.js';
import { OverviewScreen } from './views/overview.js';
import { GoalsScreen } from './views/goals.js';
import { GoalsOverviewScreen } from './views/goals_overview.js';
import { PositionsScreen } from './views/positions.js';
import { ProjectionScreen } from './views/projection_screen.js';
import { SettingsScreen } from './views/settings/index.js';
import { StatementScreen } from './views/statement.js';
import { StrategyScreen } from './views/strategy.js';

/**
 * NAV-01 · As rotas do app, sem prefixo de área.
 *
 * `/` é a Visão geral (com `escopo` e `carteira` na consulta), as telas de fluxo
 * são planas (`/lancamentos`, `/contas`…), as de carteira moram em
 * `/carteiras/<escopo>/<tela>` e `/configuracoes` fecha a lista, tudo dentro da
 * casca única (`AppLayout`). A galeria do design system continua em `/galeria`,
 * fora dela.
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

const GeralScreen = lazy(() =>
  import('./views/geral/geral_screen.js').then((module) => ({
    default: module.GeralScreen,
  })),
);

const Workspace = (): React.ReactElement => (
  <Routes>
    <Route path="/galeria" element={<Gallery />} />
    <Route element={<AppLayout />}>
      {/* Visão geral e as telas de fluxo leem os mesmos dados de Finanças: um provedor só. */}
      <Route
        element={
          <Suspense fallback={<FinanceLoading />}>
            <FinanceHost />
          </Suspense>
        }
      >
        <Route path="/" element={<Home />} />
        {financeScreenRoutes}
      </Route>
      {/* A página do ativo é uma tela dentro do escopo, e não uma tela da barra
          lateral: ela pertence ao papel, e o papel pertence à carteira. Por isso
          ela mora sob o escopo e mantém Posições destacada na navegação. */}
      <Route path="/carteiras/:scope/ativos/:asset" element={<Workbench />} />
      <Route path="/carteiras/:scope/:screen" element={<Workbench />} />
      <Route path="/carteiras/:scope" element={<Workbench />} />
      <Route
        path="/carteiras"
        element={<Navigate to={routes.portfolio(ALL_SCOPE)} replace />}
      />
      {/* Configurações vale para o app inteiro. */}
      <Route path="/livro" element={<LedgerScreen />} />
      <Route path="/cartoes-novo" element={<CardsScreen />} />
      <Route path="/cartoes-novo/:id" element={<CardScreen />} />
      <Route path="/cartoes-novo/:id/faturas/:month" element={<InvoiceScreen />} />
      <Route path="/contas-novo" element={<AccountsScreen />} />
      <Route path="/contas-novo/:id" element={<AccountStatementScreen />} />
      <Route path="/configuracoes" element={<SettingsScreen />} />
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>
);

/** NAV-14 · Rota que não existe: a casca fica, e a saída é a Visão geral. */
const NotFound = (): React.ReactElement => (
  <div role="alert" className="mx-auto max-w-md p-8 text-center">
    <h1 className="text-panel-title font-semibold">Tela não encontrada</h1>
    <p className="mt-2 text-[0.8125rem] text-ink-2">
      O endereço não corresponde a nenhuma tela do app.
    </p>
    <Link
      to={routes.home()}
      className="mt-4 inline-flex h-control cursor-pointer items-center rounded-control border border-line px-3 text-[0.8125rem] hover:bg-panel-2"
    >
      Ir para a Visão geral
    </Link>
  </div>
);

/**
 * NAV-01 · A Visão geral. O escopo da consulta escolhe o painel: `tudo` é o
 * resumo dos dois lados, `fluxo` o de Finanças e `investimentos` o das carteiras.
 */
const Home = (): React.ReactElement => {
  const { search } = useLocation();
  const place = placeForPath('/', search);
  if (place.kind !== 'home' || place.scope === 'tudo') {
    return (
      <Suspense fallback={<OverviewSkeleton />}>
        <GeralScreen />
      </Suspense>
    );
  }
  if (place.scope === 'fluxo') {
    return (
      <Suspense fallback={<OverviewSkeleton />}>
        <FinanceOverview />
      </Suspense>
    );
  }
  return <Workbench home />;
};

const Workbench = ({ home = false }: { readonly home?: boolean }): React.ReactElement => {
  const params = useParams();
  const { search } = useLocation();
  const homePlace = placeForPath('/', search);
  // Na raiz, o escopo é a `carteira` da consulta e a tela é a Visão geral.
  const scope = home
    ? homePlace.kind === 'home'
      ? homePlace.portfolio
      : ALL_SCOPE
    : (params['scope'] ?? ALL_SCOPE);
  const screen = home ? 'visao-geral' : (params['screen'] ?? 'posicoes');
  const asset = home ? undefined : params['asset'];
  const navigate = useNavigate();

  const { portfolios, slugs, loaded, failed, reload } = usePortfolios();

  const allPortfolios = scope === ALL_SCOPE;
  const portfolioId = allPortfolios ? null : portfolioIdForScope(scope, slugs);

  // Em "Todas as carteiras" só existem as telas que somam carteiras. As demais
  // (estratégia) medem uma carteira, e a página do ativo pertence ao papel
  // dentro de uma carteira: abrir uma delas aqui cai na Visão geral do escopo.
  const screens = useMemo(() => routableScreens(allPortfolios), [allPortfolios]);
  const sidebarScreens = useMemo(() => screensForScope(allPortfolios), [allPortfolios]);

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
        sidebarScreens.map((item) => [
          `go_${item.shortcut}`,
          () => navigate(routes.portfolio(scope, item.id)),
        ]),
      ),
    }),
    [navigate, scope, sidebarScreens],
  );
  useShortcuts(shortcuts);

  /**
   * "Ver lançamentos" de um ativo abre o extrato todo, e não os últimos três
   * meses: quem pergunta pelos lançamentos de um ativo quer o histórico dele.
   */
  const openStatement = (search: string): void => {
    void navigate(
      `${routes.portfolio(scope, 'movimentacoes')}?${new URLSearchParams({ busca: search, periodo: 'inicio' }).toString()}`,
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
    return <Navigate to={routes.home('investimentos', ALL_SCOPE)} replace />;
  }
  if (allPortfolios && asset !== undefined) {
    return <Navigate to={routes.portfolio(ALL_SCOPE, 'posicoes')} replace />;
  }
  // Tela desconhecida, ou que não existe neste escopo (Estratégia em Todas): a
  // Visão geral do escopo (NAV-04).
  if (asset === undefined && !screens.some((item) => item.id === screen)) {
    return <Navigate to={routes.home('investimentos', scope)} replace />;
  }

  return (
    <>
      {asset !== undefined ? (
        portfolioId === null ? null : (
          <AssetScreen
            assetRef={asset}
            portfolioId={portfolioId}
            scopeLabel={scopeLabel}
            onBack={() => navigate(routes.portfolio(scope, 'posicoes'))}
            onOpenStatement={openStatement}
          />
        )
      ) : current?.id === 'visao-geral' ? (
        <OverviewScreen
          portfolioId={portfolioId}
          {...(allPortfolios
            ? {}
            : { onOpenAsset: (slug: string) => navigate(routes.asset(scope, slug)) })}
          onOpenScreen={(path) => navigate(routes.portfolio(scope, path))}
          onOpenPortfolio={(id) => {
            const target = scopeForPortfolioId(id, slugs);
            if (target !== null) navigate(routes.home('investimentos', target));
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
              if (target !== null) navigate(routes.portfolio(target, 'objetivos'));
            }}
          />
        ) : (
          <GoalsScreen portfolioId={portfolioId} scopeLabel={scopeLabel} />
        )
      ) : current?.id === 'projecao' ? (
        <ProjectionScreen portfolioId={portfolioId} scopeLabel={scopeLabel} />
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
