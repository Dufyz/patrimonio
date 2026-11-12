import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { AreaSwitcher } from '../../components/area_switcher.js';
import type { AreaId } from '../../components/area_switcher.js';
import { Icon } from '../../components/icon.js';
import type { IconName } from '../../components/icon.js';
import { Kbd } from '../../components/primitives.js';
import { DRAWER_BELOW, ICONS_BELOW } from '../../components/shell.js';
import { browserStorage, readRaw, writeRaw } from '../../lib/preferences.js';
import { financeRoutes, screenForPath } from '../lib/routes.js';
import type { FinanceScreen } from '../lib/routes.js';

/**
 * FIN-001 · A casca da área Finanças.
 *
 * Três grupos, na ordem das pranchas: Finanças (Visão geral, Lançamentos),
 * Contas e cartões (Contas, Cartões) e Cadastros (Recorrentes, Categorias),
 * com a busca global no alto e Configurações no pé. O item da tela atual fica
 * destacado, inclusive nas telas de detalhe.
 */

export type NavItem = {
  readonly id: FinanceScreen;
  readonly label: string;
  readonly icon: IconName;
  readonly path: string;
};

export type NavGroup = {
  readonly title: string;
  readonly items: readonly NavItem[];
};

export const FINANCE_NAV: readonly NavGroup[] = [
  {
    title: 'Finanças',
    items: [
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
    ],
  },
  {
    title: 'Contas e cartões',
    items: [
      { id: 'contas', label: 'Contas', icon: 'bank', path: financeRoutes.accounts() },
      { id: 'cartoes', label: 'Cartões', icon: 'card', path: financeRoutes.cards() },
    ],
  },
  {
    title: 'Cadastros',
    items: [
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
    ],
  },
];

const COLLAPSED_KEY = 'patrimonio:sidebar-collapsed';

/** O estado recolhido é do aparelho e é o mesmo nas duas áreas. */
const useCollapsed = (): readonly [boolean, () => void] => {
  const [collapsed, setCollapsed] = useState(
    () => readRaw(browserStorage(), COLLAPSED_KEY) === '1',
  );
  const toggle = (): void =>
    setCollapsed((current) => {
      writeRaw(browserStorage(), COLLAPSED_KEY, current ? '0' : '1');
      return !current;
    });
  return [collapsed, toggle];
};

const useViewportWidth = (forced: number | undefined): number => {
  const [width, setWidth] = useState(() => forced ?? globalThis.innerWidth ?? 1440);
  useEffect(() => {
    if (forced !== undefined) return;
    const onResize = (): void => setWidth(globalThis.innerWidth);
    globalThis.addEventListener('resize', onResize);
    return () => globalThis.removeEventListener('resize', onResize);
  }, [forced]);
  return forced ?? width;
};

const NAV_BASE =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-[7px] text-left text-[0.84375rem] outline-none focus-visible:ring-2 focus-visible:ring-focus/40';
const RAIL_BASE =
  'flex h-9 w-10 cursor-pointer items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-focus/40';

export const FinanceShell = ({
  children,
  onOpenSearch,
  width: forcedWidth,
}: {
  readonly children: React.ReactNode;
  readonly onOpenSearch: () => void;
  /** Largura imposta, para teste. */
  readonly width?: number | undefined;
}): React.ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const width = useViewportWidth(forcedWidth);

  const asDrawer = width < DRAWER_BELOW;
  const iconsOnly = !asDrawer && (collapsed || width < ICONS_BELOW);
  const current = screenForPath(location.pathname);

  const go = (path: string): void => {
    void navigate(path);
    setDrawerOpen(false);
  };

  const switchArea = (area: AreaId): void => {
    go(area === 'financas' ? financeRoutes.home() : financeRoutes.investments());
  };

  const sidebar = (
    <div
      className={`flex h-full flex-col pt-3.5 pb-3 ${iconsOnly ? 'items-center px-0' : 'px-3'}`}
    >
      <div
        className={`flex items-center ${
          iconsOnly ? 'mb-1 justify-center' : 'justify-between pr-1 pb-3 pl-0.5'
        }`}
      >
        {iconsOnly ? null : <AreaSwitcher current="financas" onSelect={switchArea} />}
        {asDrawer ? null : (
          <button
            type="button"
            aria-label={iconsOnly ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            title={iconsOnly ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-panel-2 hover:text-ink"
            onClick={toggleCollapsed}
          >
            <Icon name="sidebar" />
          </button>
        )}
      </div>

      {iconsOnly ? (
        <button
          type="button"
          aria-label="Buscar"
          title="Buscar (⌘K)"
          className="mb-1.5 inline-flex size-9 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-panel-2 hover:text-ink"
          onClick={onOpenSearch}
        >
          <Icon name="search" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Buscar"
          className="mb-2 inline-flex h-control w-full cursor-pointer items-center justify-between gap-2 rounded-control border border-line-2 bg-panel px-[11px] text-[0.78125rem] font-medium text-ink-3 hover:bg-panel-2"
          onClick={onOpenSearch}
        >
          <span className="flex items-center gap-2">
            <Icon name="search" />
            Buscar
          </span>
          <Kbd>⌘K</Kbd>
        </button>
      )}

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${
          iconsOnly ? 'items-center' : '-mx-1 px-1'
        }`}
      >
        {FINANCE_NAV.map((group, index) => (
          <section
            key={group.title}
            aria-label={group.title}
            className={iconsOnly ? 'flex flex-col items-center' : undefined}
          >
            {iconsOnly ? (
              index === 0 ? null : (
                <div className="my-2 w-8 border-t border-line" />
              )
            ) : (
              <h3
                className={`tabular px-2.5 pt-2 pb-1.5 text-label font-semibold tracking-[0.1em] text-ink-3 uppercase ${
                  index === 0 ? '' : 'mt-2.5 border-t border-line pt-4'
                }`}
              >
                {group.title}
              </h3>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    title={item.label}
                    aria-current={item.id === current ? 'page' : undefined}
                    className={`${iconsOnly ? RAIL_BASE : NAV_BASE} ${
                      item.id === current
                        ? 'bg-nav-active font-medium text-ink'
                        : 'text-ink-2 hover:bg-panel-2 hover:text-ink'
                    }`}
                    onClick={() => go(item.path)}
                  >
                    <span
                      aria-hidden="true"
                      className={item.id === current ? 'text-accent' : undefined}
                    >
                      <Icon name={item.icon} />
                    </span>
                    {iconsOnly ? null : item.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-2 border-t border-line pt-2">
        <button
          type="button"
          title="Configurações"
          aria-current={current === 'configuracoes' ? 'page' : undefined}
          className={`${iconsOnly ? RAIL_BASE : NAV_BASE} ${
            current === 'configuracoes'
              ? 'bg-nav-active font-medium text-ink'
              : 'text-ink-2 hover:bg-panel-2 hover:text-ink'
          }`}
          onClick={() => go(financeRoutes.settings())}
        >
          <span className={current === 'configuracoes' ? 'text-accent' : undefined}>
            <Icon name="settings" />
          </span>
          {iconsOnly ? null : 'Configurações'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh bg-bg">
      {asDrawer ? (
        drawerOpen ? (
          <div className="fixed inset-0 z-40 flex">
            <nav
              aria-label="Navegação de Finanças"
              className="h-dvh w-64 border-r border-line bg-panel"
            >
              {sidebar}
            </nav>
            <button
              type="button"
              aria-label="Fechar a barra lateral"
              className="flex-1 cursor-default bg-overlay"
              onClick={() => setDrawerOpen(false)}
            />
          </div>
        ) : null
      ) : (
        <nav
          aria-label="Navegação de Finanças"
          className={`sticky top-0 h-dvh shrink-0 self-start border-r border-line bg-panel ${
            iconsOnly ? 'w-[60px]' : 'w-[248px]'
          }`}
        >
          {sidebar}
        </nav>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {asDrawer ? (
          <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2">
            <button
              type="button"
              aria-label="Abrir a barra lateral"
              aria-expanded={drawerOpen}
              className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-2"
              onClick={() => setDrawerOpen(true)}
            >
              <Icon name="list" />
              Finanças
            </button>
          </div>
        ) : null}
        <main className="min-w-0 flex-1 px-7 pt-5 pb-10">{children}</main>
      </div>
    </div>
  );
};
