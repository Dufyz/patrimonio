import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { fetchMarketHealth } from './api/market.js';
import { usePortfolios } from './components/portfolios_provider.js';
import { ALL_PORTFOLIOS, AppShell } from './components/shell.js';
import type { NavEntry, PortfolioEntry, ShellActive } from './components/shell.js';
import { ShellSearchContext } from './components/shell_search.js';
import { financeRoutes } from './finance/lib/routes.js';
import { screensForScope, screenInScope } from './lib/investment_screens.js';
import {
  readLastPath,
  readLastScope,
  writeLastArea,
  writeLastPath,
  writeLastScope,
} from './lib/last_area.js';
import { placeForPath, routes } from './lib/routes.js';
import { ALL_SCOPE, portfolioIdForScope } from './lib/scope.js';
import { hasDemoData } from './lib/settings.js';
import { useResource } from './lib/use_resource.js';

/**
 * NAV-002 · A casca única, ligada à URL.
 *
 * Decide, para cada item da barra lateral, o caminho de destino (NAV-004): trocar
 * de carteira mantém a tela quando ela existe no novo escopo e cai na Visão
 * geral quando não existe; tocar numa tela de Investimentos vindo de Geral ou
 * Finanças usa a última carteira. A barra em si não conhece rotas.
 */

const FINANCE_ENTRIES: readonly NavEntry[] = [
  {
    id: 'visao-geral',
    label: 'Visão geral',
    icon: 'grid',
    path: financeRoutes.overview(),
  },
  {
    id: 'lancamentos',
    label: 'Lançamentos',
    icon: 'swap',
    path: financeRoutes.entries(),
  },
  { id: 'contas', label: 'Contas', icon: 'bank', path: financeRoutes.accounts() },
  { id: 'cartoes', label: 'Cartões', icon: 'card', path: financeRoutes.cards() },
  {
    id: 'recorrentes',
    label: 'Recorrentes',
    icon: 'repeat',
    path: financeRoutes.recurrings(),
  },
  {
    id: 'categorias',
    label: 'Categorias',
    icon: 'tag',
    path: financeRoutes.categories(),
  },
];

const FINANCE_SCREEN_IDS: ReadonlySet<string> = new Set(
  FINANCE_ENTRIES.map((entry) => entry.id),
);

/** O título da tela de agora, para a gaveta. */
const titleFor = (active: ShellActive, scopeLabel: string): string => {
  switch (active.area) {
    case 'geral':
      return 'Geral';
    case 'configuracoes':
      return 'Configurações';
    case 'financas':
      return `Finanças · ${
        FINANCE_ENTRIES.find((entry) => entry.id === active.screen)?.label ??
        'Visão geral'
      }`;
    case 'investimentos':
      return scopeLabel;
  }
};

export const AppLayout = (): React.ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const { portfolios, values, total, slugs } = usePortfolios();
  const place = useMemo(() => placeForPath(location.pathname), [location.pathname]);

  // NAV-004 · a última tela de cada área e a última carteira, por aparelho.
  useEffect(() => {
    if (place.area === 'configuracoes') return;
    writeLastArea(place.area);
    writeLastPath(place.area, location.pathname);
    if (place.area === 'investimentos') writeLastScope(place.scope);
  }, [place, location.pathname]);

  const health = useResource((signal) => fetchMarketHealth(signal), []);
  const demo = health.state.kind === 'ready' && hasDemoData(health.state.value.demo);

  // Quem registra a busca é a área aberta; o botão da barra só a chama.
  const searchRef = useRef<(() => void) | null>(null);
  const search = useMemo(
    () => ({
      register: (open: (() => void) | null) => {
        searchRef.current = open;
      },
    }),
    [],
  );
  const openSearch = useCallback(() => searchRef.current?.(), []);

  // O escopo mostrado na barra: o da URL em Investimentos, o último nas demais.
  const scope =
    place.area === 'investimentos' ? place.scope : (readLastScope() ?? ALL_SCOPE);
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
        path: routes.investments(scope, screen.id),
      })),
    [allPortfolios, scope],
  );

  // Trocar de carteira mantém a tela; fora de Investimentos, usa a última usada.
  const screenAfterSwitch = useMemo(() => {
    if (place.area === 'investimentos') return place.screen;
    const last = readLastPath('investimentos');
    return last === null ? 'visao-geral' : (placeForPathScreen(last) ?? 'visao-geral');
  }, [place]);

  const portfolioEntries = useMemo(
    (): readonly PortfolioEntry[] => [
      {
        id: ALL_PORTFOLIOS,
        label: 'Todas as carteiras',
        value: total,
        path: routes.investments(ALL_SCOPE, screenInScope(screenAfterSwitch, true)),
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
                path: routes.investments(slug, screenInScope(screenAfterSwitch, false)),
              },
            ];
      }),
    ],
    [portfolios, slugs, total, values, screenAfterSwitch],
  );

  const active: ShellActive =
    place.area === 'investimentos'
      ? {
          area: 'investimentos',
          scope: scopeId ?? '',
          screen: place.screen === 'ativo' ? 'posicoes' : place.screen,
        }
      : place.area === 'financas'
        ? {
            area: 'financas',
            screen: FINANCE_SCREEN_IDS.has(place.screen) ? place.screen : 'visao-geral',
          }
        : place;

  return (
    <ShellSearchContext.Provider value={search}>
      <AppShell
        geral={{ id: 'geral', label: 'Visão geral', icon: 'grid', path: routes.geral() }}
        finance={FINANCE_ENTRIES}
        portfolios={portfolioEntries}
        screens={screens}
        active={active}
        title={titleFor(active, scopeLabel)}
        settingsPath={routes.settings()}
        onGo={(path) => void navigate(path)}
        onOpenSearch={openSearch}
        demo={demo}
      >
        <Outlet />
      </AppShell>
    </ShellSearchContext.Provider>
  );
};

/** A tela de Investimentos de um caminho guardado, ou nulo se não for dela. */
const placeForPathScreen = (path: string): string | null => {
  const place = placeForPath(path);
  return place.area === 'investimentos' ? place.screen : null;
};
