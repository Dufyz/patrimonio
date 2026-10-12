import type { PortfolioResource } from '@patrimonio/contracts';
import { useEffect, useMemo, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  BrowserRouter,
} from 'react-router';

import { fetchMarketHealth } from './api/market.js';
import { fetchPortfolios } from './api/portfolios.js';
import { Icon } from './components/icon.js';
import type { IconName } from './components/icon.js';
import { EntryProvider, useEntry } from './components/entry_provider.js';
import { SearchPalette } from './components/search_palette.js';
import { ShortcutProvider, useShortcuts } from './components/shortcuts.js';
import { ALL_PORTFOLIOS, AppShell } from './components/shell.js';
import type { ScreenItem } from './components/shell.js';
import { hasDemoData } from './lib/settings.js';
import { useResource } from './lib/use_resource.js';
import {
  ALL_SCOPE,
  portfolioIdForScope,
  portfolioSlugs,
  scopeForPortfolioId,
} from './lib/scope.js';
import { describeShortcut, SHORTCUTS } from './lib/shortcuts.js';
import { onPortfoliosChanged } from './lib/portfolio_events.js';
import { targetPath } from './lib/search.js';
import type { SearchActionId, SearchTarget } from './lib/search.js';
import { AssetScreen } from './views/asset.js';
import { Gallery } from './views/gallery.js';
import { OverviewScreen } from './views/overview.js';
import { GoalsScreen } from './views/goals.js';
import { PositionsScreen } from './views/positions.js';
import { SettingsScreen } from './views/settings/index.js';
import { StatementScreen } from './views/statement.js';
import { StrategyScreen } from './views/strategy.js';

/**
 * E6 · A moldura e as telas.
 *
 * Até E5 o que a aplicação abria era a galeria do design system. Agora ela abre
 * a Visão geral, como a prancha `02 · Mapa de telas e navegação` manda — é a
 * tela que responde "quanto eu tenho hoje" —, e a galeria continua existindo em
 * `/galeria`: ela é o lugar onde uma mudança no botão aparece antes de aparecer
 * em seis telas.
 *
 * O escopo e a tela vivem na URL, não em estado. Trocar de carteira mantém a
 * tela atual, porque quem troca está comparando, não recomeçando.
 */

const SCREENS: readonly (ScreenItem & {
  readonly path: string;
  readonly story: string;
  readonly glyph: IconName;
  /** A tela também existe em "Todas as carteiras". */
  readonly consolidated: boolean;
})[] = (
  [
    {
      id: 'visao',
      label: 'Visão geral',
      glyph: 'grid',
      path: 'visao-geral',
      story: 'T-01',
      consolidated: true,
    },
    {
      id: 'posicoes',
      label: 'Posições',
      glyph: 'list',
      path: 'posicoes',
      story: 'T-02',
      consolidated: true,
    },
    {
      id: 'movimentacoes',
      label: 'Movimentações',
      glyph: 'swap',
      path: 'movimentacoes',
      story: 'T-04',
      consolidated: true,
    },
    {
      id: 'estrategia',
      label: 'Estratégia',
      glyph: 'target',
      path: 'estrategia',
      story: 'T-06',
      consolidated: false,
    },
    {
      id: 'objetivos',
      label: 'Objetivos',
      glyph: 'flag',
      path: 'objetivos',
      story: 'T-07',
      consolidated: false,
    },
  ] as const
).map((item) => ({ ...item, icon: <Icon name={item.glyph} /> }));

export const App = (): React.ReactElement => (
  <BrowserRouter>
    <ShortcutProvider>
      <Workspace />
    </ShortcutProvider>
  </BrowserRouter>
);

const Workspace = (): React.ReactElement => (
  <Routes>
    <Route path="/galeria" element={<Gallery />} />
    {/* A página do ativo é uma tela dentro do escopo, e não uma tela da barra
        lateral: ela pertence ao papel, e o papel pertence à carteira. Por isso
        ela mora sob o escopo e mantém Posições destacada na navegação. */}
    <Route path="/:scope/ativo/:asset" element={<Workbench />} />
    <Route path="/:scope/:screen" element={<Workbench />} />
    <Route path="*" element={<Navigate to={`/${ALL_SCOPE}/visao-geral`} replace />} />
  </Routes>
);

const Workbench = (): React.ReactElement => {
  const { scope = ALL_SCOPE, screen = 'visao-geral', asset } = useParams();
  const navigate = useNavigate();

  const [portfolios, setPortfolios] = useState<readonly PortfolioResource[]>([]);
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [total, setTotal] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [reloads, setReloads] = useState(0);
  useEffect(() => onPortfoliosChanged(() => setReloads((count) => count + 1)), []);

  useEffect(() => {
    const controller = new AbortController();
    fetchPortfolios(controller.signal)
      .then((list) => {
        setPortfolios(list.portfolios);
        setValues(list.values);
        setTotal(list.total);
        setLoaded(true);
      })
      .catch(() => {
        setPortfolios([]);
        setValues({});
        setTotal(null);
        setLoaded(controller.signal.aborted ? false : true);
      });
    return () => controller.abort();
  }, [reloads]);

  const slugs = useMemo(() => portfolioSlugs(portfolios), [portfolios]);
  const allPortfolios = scope === ALL_SCOPE;
  const portfolioId = allPortfolios ? null : portfolioIdForScope(scope, slugs);

  // Em "Todas as carteiras" só existem as telas que somam carteiras. As demais
  // (estratégia, objetivos) medem uma carteira, e a página do ativo pertence ao
  // papel dentro de uma carteira: abrir uma delas aqui cai na tela mais próxima.
  const screens = useMemo(
    () => (allPortfolios ? SCREENS.filter((item) => item.consolidated) : SCREENS),
    [allPortfolios],
  );

  // Com um ativo na URL, a tela ativa continua sendo Posições: a página do
  // ativo foi aberta de lá, e é para lá que a trilha volta.
  const current =
    asset === undefined
      ? (screens.find((item) => item.path === screen) ?? screens[0])
      : SCREENS[1];
  // Configurações não está na lista de telas da carteira: ela vale para o app
  // inteiro, e o botão dela fica no pé da barra lateral. `/:escopo/configuracoes`
  // mantém o escopo na URL só para a barra lateral continuar a mesma.
  const onSettings = asset === undefined && screen === 'configuracoes';
  const scopeLabel = allPortfolios
    ? 'Todas as carteiras'
    : (portfolios.find((item) => item.id === portfolioId)?.name ?? 'Carteira');

  const shortcuts = useMemo(
    () => ({
      ...Object.fromEntries(
        screens.map((item) => [
          `go_${SHORTCUT_IDS[item.id] ?? item.id}`,
          () => navigate(`/${scope}/${item.path}`),
        ]),
      ),
      // ⌘K abre e fecha: quem a abriu sem querer não precisa procurar o Esc.
      search: () => setSearchOpen((open) => !open),
    }),
    [navigate, scope],
  );
  useShortcuts(shortcuts);

  /**
   * As telas como a paleta as lista, com o atalho que cada uma realmente tem.
   * Configurações fecha a lista, como fecha a barra lateral, e não tem atalho.
   */
  const searchScreens = useMemo(
    () => [
      ...screens.map((item) => {
        const shortcut = SHORTCUTS.find(
          (candidate) => candidate.id === `go_${SHORTCUT_IDS[item.id] ?? item.id}`,
        );
        return {
          id: item.id,
          label: item.label,
          glyph: item.glyph,
          shortcut: shortcut === undefined ? null : describeShortcut(shortcut),
        };
      }),
      { id: SETTINGS_SCREEN, label: 'Configurações', glyph: 'settings', shortcut: null },
    ],
    [screens],
  );

  const searchPortfolios = useMemo(
    () => [
      { id: ALL_PORTFOLIOS, label: 'Todas as carteiras' },
      ...portfolios.map((portfolio) => ({ id: portfolio.id, label: portfolio.name })),
    ],
    [portfolios],
  );

  const health = useResource((signal) => fetchMarketHealth(signal), []);
  const demo = health.state.kind === 'ready' && hasDemoData(health.state.value.demo);

  /**
   * "Ver lançamentos" de um ativo abre o extrato todo, e não os últimos três
   * meses: quem pergunta pelos lançamentos de um ativo quer o histórico dele.
   */
  const openStatement = (search: string): void => {
    void navigate(
      `/${scope}/movimentacoes?${new URLSearchParams({ busca: search, periodo: 'inicio' }).toString()}`,
    );
  };

  /** O que a paleta faz com o destino escolhido. As regras estão em `targetPath`. */
  const openTarget = (target: SearchTarget): void => {
    const path = targetPath(target, {
      scope,
      currentScreenPath: current?.path ?? 'visao-geral',
      screenPaths: {
        ...Object.fromEntries(SCREENS.map((item) => [item.id, item.path])),
        [SETTINGS_SCREEN]: 'configuracoes',
      },
      scopeFor: (id) =>
        id === ALL_PORTFOLIOS ? ALL_SCOPE : (scopeForPortfolioId(id, slugs) ?? scope),
    });

    // Sem página de ativo em "Todas as carteiras": o ativo aparece em Posições,
    // já filtrado por ele, com a carteira de cada linha.
    if (allPortfolios && target.kind === 'asset') {
      void navigate(
        `/${ALL_SCOPE}/posicoes?${new URLSearchParams({ busca: target.slug }).toString()}`,
      );
      return;
    }

    // Ação não é navegação: quem a executa é o `Palette`, que abre o modal.
    if (path !== null) void navigate(path);
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
    if (targetScope !== null) void navigate(`/${targetScope}/ativo/${slug}`);
  };

  if (!loaded) return <div className="p-6 text-[0.8125rem] text-ink-3">Carregando…</div>;

  const first = portfolios[0];
  if (first === undefined) {
    return (
      <div className="p-6">
        <SettingsScreen />
      </div>
    );
  }
  if (!allPortfolios && portfolioId === null) {
    return <Navigate to={`/${ALL_SCOPE}/visao-geral`} replace />;
  }
  if (allPortfolios && asset !== undefined) {
    return <Navigate to={`/${ALL_SCOPE}/posicoes`} replace />;
  }
  if (
    allPortfolios &&
    !onSettings &&
    !screens.some((item) => item.path === screen)
  ) {
    return <Navigate to={`/${ALL_SCOPE}/visao-geral`} replace />;
  }

  return (
    <EntryProvider scopePortfolioId={portfolioId}>
      <AppShell
        portfolios={[
          { id: ALL_PORTFOLIOS, label: 'Todas as carteiras', value: total },
          ...portfolios.map((portfolio) => ({
            id: portfolio.id,
            label: portfolio.name,
            value: values[portfolio.id] ?? null,
          })),
        ]}
        screens={screens.map(({ id, label, icon }) => ({ id, label, icon }))}
        scope={portfolioId ?? ALL_PORTFOLIOS}
        screen={onSettings ? 'configuracoes' : (current?.id ?? 'visao')}
        onNavigate={(nextScope, nextScreen) => {
          const toAll = nextScope === ALL_PORTFOLIOS;
          const available = toAll ? SCREENS.filter((item) => item.consolidated) : SCREENS;
          const target = available.find((item) => item.id === nextScreen) ?? available[0];
          const slug = toAll ? ALL_SCOPE : (scopeForPortfolioId(nextScope, slugs) ?? scope);
          navigate(`/${slug}/${target?.path ?? 'visao-geral'}`);
        }}
        onOpenSearch={() => setSearchOpen(true)}
        settingsActive={onSettings}
        demo={demo}
        onOpenSettings={() => navigate(`/${scope}/configuracoes`)}
      >
        {asset !== undefined ? (
          portfolioId === null ? null : (
            <AssetScreen
              assetRef={asset}
              portfolioId={portfolioId}
              scopeLabel={scopeLabel}
              onBack={() => navigate(`/${scope}/posicoes`)}
              onOpenStatement={openStatement}
            />
          )
        ) : onSettings ? (
          <SettingsScreen />
        ) : current?.id === 'visao' ? (
          <OverviewScreen
            portfolioId={portfolioId}
            {...(allPortfolios
              ? {}
              : { onOpenAsset: (slug: string) => navigate(`/${scope}/ativo/${slug}`) })}
            onOpenScreen={(path) => navigate(`/${scope}/${path}`)}
            onOpenPortfolio={(id) => {
              const target = scopeForPortfolioId(id, slugs);
              if (target !== null) navigate(`/${target}/visao-geral`);
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
          portfolioId === null ? null : <StrategyScreen portfolioId={portfolioId} />
        ) : current?.id === 'objetivos' ? (
          portfolioId === null ? null : (
            <GoalsScreen portfolioId={portfolioId} scopeLabel={scopeLabel} />
          )
        ) : (
          <ScreenPending label={current?.label ?? ''} story={current?.story ?? ''} />
        )}
      </AppShell>
      <Palette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        scopeLabel={scopeLabel}
        portfolioId={portfolioId}
        screens={searchScreens}
        portfolios={searchPortfolios}
        onSelect={openTarget}
      />
    </EntryProvider>
  );
};

/** As ações da paleta que o modal de lançamento executa. */
const READY_ACTIONS: ReadonlySet<SearchActionId> = new Set([
  'new_transaction',
  'buy_asset',
  'payout_asset',
]);

/**
 * A paleta mora dentro do provedor de lançamento: escolher "Comprar ITUB4" abre
 * o modal já nesse ativo, em vez de navegar para uma tela.
 */
const Palette = ({
  onSelect,
  ...rest
}: Omit<React.ComponentProps<typeof SearchPalette>, 'readyActions' | 'onSelect'> & {
  readonly onSelect: (target: SearchTarget) => void;
}): React.ReactElement => {
  const entry = useEntry();

  return (
    <SearchPalette
      {...rest}
      readyActions={READY_ACTIONS}
      onSelect={(target) => {
        if (target.kind === 'instrument') {
          entry.openEntry({
            tab: 'buy',
            asset: {
              id: null,
              instrument: {
                ticker: target.ticker,
                name: target.name,
                b3_type: target.b3_type,
              },
              label: target.ticker,
              name: target.name,
              held: null,
            },
          });
          return;
        }

        if (target.kind !== 'action') {
          onSelect(target);
          return;
        }

        const asset =
          target.assetId === undefined
            ? null
            : {
                id: target.assetId,
                instrument: null,
                label: target.title ?? '',
                name: null,
                held: null,
              };

        entry.openEntry({
          tab: target.action === 'payout_asset' ? 'payout' : 'buy',
          asset,
        });
      }}
    />
  );
};

/** O identificador de Configurações na paleta: ela não está em `SCREENS`. */
const SETTINGS_SCREEN = 'configuracoes';

const SHORTCUT_IDS: Readonly<Record<string, string>> = {
  visao: 'overview',
  posicoes: 'positions',
  movimentacoes: 'transactions',
  estrategia: 'strategy',
  objetivos: 'goals',
};

/**
 * A tela que ainda não existe diz qual história a entrega, em vez de abrir em
 * branco. Em E6 ela some uma por vez.
 */
const ScreenPending = ({
  label,
  story,
}: {
  readonly label: string;
  readonly story: string;
}): React.ReactElement => (
  <div className="flex flex-col gap-1 rounded-panel border border-line bg-panel p-6">
    <h1 className="text-base font-semibold">{label}</h1>
    <p className="text-[0.8125rem] text-ink-3">
      Esta tela chega com {story}. As demais telas já estão de pé.
    </p>
  </div>
);
