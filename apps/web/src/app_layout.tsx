import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { fetchMarketHealth } from './api/market.js';
import { EntryProvider } from './components/entry_provider.js';
import { usePortfolios } from './components/portfolios_provider.js';
import { ALL_PORTFOLIOS, AppShell } from './components/shell.js';
import type { NavEntry, NavGroup, PortfolioEntry } from './components/shell.js';
import { useShortcuts } from './components/shortcuts.js';
import { FinanceProviders } from './finance/finance_app.js';
import type { FinanceStore } from './finance/store/finance_store.js';
import { GlobalSearch } from './global_search.js';
import { screensForScope, screenInScope } from './lib/investment_screens.js';
import { readLastScope, writeLastScope } from './lib/last_scope.js';
import { navIdForPlace, placeForPath, routes } from './lib/routes.js';
import type { Place } from './lib/routes.js';
import type { SearchScreen } from './lib/search.js';
import { describeShortcut, SHORTCUTS } from './lib/shortcuts.js';
import { ALL_SCOPE, portfolioIdForScope } from './lib/scope.js';
import { hasDemoData } from './lib/settings.js';
import { useResource } from './lib/use_resource.js';

/**
 * NAV-02 · A casca única, ligada à URL.
 *
 * Decide, para cada item da barra lateral, o caminho de destino (NAV-04): trocar
 * de carteira mantém a tela quando ela existe no novo escopo e cai na Visão geral
 * do escopo quando não existe; clicar numa carteira estando numa tela de fluxo
 * abre a Visão geral de Investimentos dela. A barra em si não conhece rotas.
 */

const FLOW_ENTRIES: Readonly<Record<string, NavEntry>> = {
  overview: {
    id: 'visao-geral',
    label: 'Visão geral',
    icon: 'grid',
    path: routes.home(),
  },
  entries: {
    id: 'lancamentos',
    label: 'Lançamentos',
    icon: 'swap',
    path: '/lancamentos',
  },
  accounts: { id: 'contas', label: 'Contas', icon: 'bank', path: '/contas' },
  cards: { id: 'cartoes', label: 'Cartões', icon: 'card', path: '/cartoes' },
  recurrings: {
    id: 'recorrentes',
    label: 'Recorrentes',
    icon: 'repeat',
    path: '/recorrentes',
  },
  categories: { id: 'categorias', label: 'Categorias', icon: 'tag', path: '/categorias' },
};

/** A carteira que a URL de agora nomeia, ou nulo quando ela não nomeia nenhuma. */
const scopeOfPlace = (place: Place): string | null => {
  if (place.kind === 'portfolios') return place.scope;
  if (place.kind === 'home' && place.scope === 'investimentos') return place.portfolio;
  return null;
};

/** O título da tela de agora, para a gaveta. */
const titleFor = (place: Place, scopeLabel: string): string => {
  switch (place.kind) {
    case 'home':
      return place.scope === 'investimentos'
        ? `Visão geral · ${scopeLabel}`
        : 'Visão geral';
    case 'flow':
      return (
        FLOW_ENTRIES[
          {
            lancamentos: 'entries',
            contas: 'accounts',
            cartoes: 'cards',
            recorrentes: 'recurrings',
            categorias: 'categories',
          }[place.screen]
        ]?.label ?? 'Patrimônio'
      );
    case 'portfolios':
      return scopeLabel;
    case 'settings':
      return 'Configurações';
    case 'unknown':
      return 'Tela não encontrada';
  }
};

export const AppLayout = ({
  financeStore,
}: {
  /** Troca-se nos testes para não depender da rede. */
  readonly financeStore?: FinanceStore;
}): React.ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const { portfolios, values, total, slugs } = usePortfolios();
  const place = useMemo(
    () => placeForPath(location.pathname, location.search),
    [location.pathname, location.search],
  );

  // NAV-04 · a última carteira aberta, por aparelho.
  const placeScope = scopeOfPlace(place);
  useEffect(() => {
    if (placeScope !== null) writeLastScope(placeScope);
  }, [placeScope]);

  const health = useResource((signal) => fetchMarketHealth(signal), []);
  const demo = health.state.kind === 'ready' && hasDemoData(health.state.value.demo);

  // NAV-007 · a busca é uma só. ⌘K abre e fecha: quem a abriu sem querer não
  // precisa procurar o Esc.
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const toggleSearch = useCallback(() => setSearchOpen((open) => !open), []);

  // O escopo das telas de carteira da barra: o da URL, ou o último usado.
  const scope = placeScope ?? readLastScope() ?? ALL_SCOPE;
  const allPortfolios = scope === ALL_SCOPE;
  const scopeId = allPortfolios ? ALL_PORTFOLIOS : portfolioIdForScope(scope, slugs);

  const scopeLabel = allPortfolios
    ? 'Todas as carteiras'
    : (portfolios.find((item) => item.id === scopeId)?.name ?? 'Carteira');

  const screens = useMemo(
    () =>
      screensForScope(allPortfolios).map((screen): NavEntry => ({
        id: screen.id,
        label: screen.label,
        icon: screen.icon,
        path: routes.portfolio(scope, screen.id),
      })),
    [allPortfolios, scope],
  );

  // Trocar de carteira mantém a tela (NAV-04): numa tela de carteira, a mesma tela
  // no novo escopo (ou a Visão geral dele, se ela não existir lá); em qualquer
  // outra, a Visão geral de Investimentos da carteira.
  const pathForPortfolio = useCallback(
    (target: string): string => {
      const toAll = target === ALL_SCOPE;
      if (place.kind === 'portfolios') {
        return routes.portfolio(target, screenInScope(place.screen, toAll));
      }
      return routes.home('investimentos', target);
    },
    [place],
  );

  const portfolioEntries = useMemo(
    (): readonly PortfolioEntry[] => [
      {
        id: ALL_PORTFOLIOS,
        label: 'Todas as carteiras',
        value: total,
        path: pathForPortfolio(ALL_SCOPE),
      },
      ...portfolios.flatMap((portfolio): PortfolioEntry[] => {
        const slug = slugs.get(portfolio.id);
        return slug === undefined
          ? []
          : [
              {
                id: portfolio.id,
                label: portfolio.name,
                value: values[portfolio.id] ?? null,
                path: pathForPortfolio(slug),
              },
            ];
      }),
    ],
    [portfolios, slugs, total, values, pathForPortfolio],
  );

  const groups = useMemo(
    (): readonly NavGroup[] => [
      {
        id: 'principal',
        title: null,
        entries: [FLOW_ENTRIES['overview'], FLOW_ENTRIES['entries']].filter(
          (entry): entry is NavEntry => entry !== undefined,
        ),
      },
      {
        id: 'contas-e-cartoes',
        title: 'Contas e cartões',
        entries: [FLOW_ENTRIES['accounts'], FLOW_ENTRIES['cards']].filter(
          (entry): entry is NavEntry => entry !== undefined,
        ),
      },
      {
        id: 'carteiras',
        title: 'Carteiras',
        portfolios: portfolioEntries,
        entries: screens,
      },
      {
        id: 'planejamento',
        title: 'Planejamento',
        entries: [FLOW_ENTRIES['recurrings']].filter(
          (entry): entry is NavEntry => entry !== undefined,
        ),
      },
      {
        id: 'cadastros',
        title: 'Cadastros',
        entries: [FLOW_ENTRIES['categories']].filter(
          (entry): entry is NavEntry => entry !== undefined,
        ),
      },
    ],
    [portfolioEntries, screens],
  );

  // O seletor destaca a carteira da URL; fora de uma tela de carteira, nenhuma.
  const activePortfolio = placeScope === null ? null : (scopeId ?? null);

  // `G V` vale em qualquer tela. As demais letras de `G` são as das telas de
  // carteira, ligadas pela própria tela. A camada da casca é a mais antiga: as
  // telas respondem antes dela.
  // NAV-11 · Cada atalho de `G` leva à tela que o menu lista com o mesmo nome, e
  // `⌘1..3` às três primeiras carteiras da barra. Carteira que não existe deixa
  // a tecla sem efeito: a chave só entra no objeto quando há para onde ir.
  const globalShortcuts = useMemo(() => {
    const goto = (path: string) => () => void navigate(path);
    const nth = portfolioEntries.filter((entry) => entry.id !== ALL_PORTFOLIOS);
    const jump = (index: number): Record<string, () => void> => {
      const target = nth[index];
      return target === undefined
        ? {}
        : { [`portfolio_${index + 1}`]: goto(target.path) };
    };
    return {
      go_overview: goto(routes.home()),
      go_entries: goto('/lancamentos'),
      go_accounts: goto('/contas'),
      go_cards: goto('/cartoes'),
      go_recurrings: goto('/recorrentes'),
      go_categories: goto('/categorias'),
      go_settings: goto(routes.settings()),
      ...jump(0),
      ...jump(1),
      ...jump(2),
      search: toggleSearch,
    };
  }, [navigate, toggleSearch, portfolioEntries]);
  useShortcuts(globalShortcuts);

  /** As telas do app, como a paleta as lista, com o atalho que cada uma realmente tem. */
  const searchScreens = useMemo((): readonly SearchScreen[] => {
    const shortcutOf = (id: string): string | null => {
      const shortcut = SHORTCUTS.find((candidate) => candidate.id === id);
      return shortcut === undefined ? null : describeShortcut(shortcut);
    };
    const flow = (entry: NavEntry | undefined): SearchScreen[] =>
      entry === undefined
        ? []
        : [
            {
              id: `fluxo-${entry.id}`,
              label: entry.label,
              glyph: entry.icon,
              shortcut: shortcutOf(
                {
                  'visao-geral': 'go_overview',
                  lancamentos: 'go_entries',
                  contas: 'go_accounts',
                  cartoes: 'go_cards',
                  recorrentes: 'go_recurrings',
                  categorias: 'go_categories',
                }[entry.id] ?? '',
              ),
              module: entry.id === 'visao-geral' ? 'geral' : 'financas',
              path: entry.path,
            },
          ];
    return [
      ...flow(FLOW_ENTRIES['overview']),
      ...flow(FLOW_ENTRIES['entries']),
      ...flow(FLOW_ENTRIES['accounts']),
      ...flow(FLOW_ENTRIES['cards']),
      ...screensForScope(allPortfolios).map((screen): SearchScreen => ({
        id: screen.id,
        label: screen.label,
        glyph: screen.icon,
        shortcut: shortcutOf(`go_${screen.shortcut}`),
        detail: scopeLabel,
        module: 'investimentos',
        path: routes.portfolio(scope, screen.id),
      })),
      ...flow(FLOW_ENTRIES['recurrings']),
      ...flow(FLOW_ENTRIES['categories']),
      {
        id: 'configuracoes',
        label: 'Configurações',
        glyph: 'settings',
        shortcut: shortcutOf('go_settings'),
        module: 'geral',
        path: routes.settings(),
      },
    ];
  }, [allPortfolios, scope, scopeLabel]);

  const inFinance = place.kind === 'home' || place.kind === 'flow';
  const currentScreen =
    place.kind === 'portfolios' && place.screen !== 'ativo'
      ? place.screen
      : 'visao-geral';

  return (
    <FinanceProviders store={financeStore}>
      <EntryProvider scopePortfolioId={allPortfolios ? null : scopeId}>
        <AppShell
          groups={groups}
          activeId={navIdForPlace(place)}
          activePortfolio={activePortfolio}
          title={titleFor(place, scopeLabel)}
          settingsPath={routes.settings()}
          onGo={(path) => void navigate(path)}
          onOpenSearch={openSearch}
          demo={demo}
        >
          <Outlet />
        </AppShell>
        <GlobalSearch
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          scope={scope}
          scopeLabel={scopeLabel}
          portfolioId={allPortfolios ? null : scopeId}
          currentScreen={currentScreen}
          inFinance={inFinance}
          screens={searchScreens}
        />
      </EntryProvider>
    </FinanceProviders>
  );
};
