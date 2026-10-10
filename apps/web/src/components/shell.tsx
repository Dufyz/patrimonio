import { useEffect, useRef, useState } from 'react';

import { Compact } from './number.js';
import { Kbd, Label } from './primitives.js';

/**
 * D-10 · A moldura da aplicação.
 *
 * A barra lateral lista as carteiras primeiro e, abaixo delas, as telas da
 * carteira escolhida. A ordem não é estética: trocar de carteira é trocar de
 * espaço de trabalho, e trocar de tela é andar dentro dele. O título acima das
 * telas repete o nome da carteira, então nunca há dúvida sobre de qual carteira
 * é a tabela que está na tela.
 *
 * Trocar de carteira mantém a tela atual — de Posições de uma carteira se vai
 * para Posições da outra — porque quem troca está comparando, não recomeçando.
 *
 * O escopo e a tela vivem na URL, e não em estado: voltar, avançar e abrir em
 * nova aba preservam a seleção, que é o que `/longo-prazo/posicoes` promete ao
 * ser colada em outro lugar.
 */

export const ALL_PORTFOLIOS = 'todas';

export type ScreenItem = {
  readonly id: string;
  readonly label: string;
  readonly icon: React.ReactNode;
};

export type PortfolioItem = {
  readonly id: string;
  readonly label: string;
  readonly value: string | null;
};

export type AppShellProps = {
  readonly portfolios: readonly PortfolioItem[];
  readonly screens: readonly ScreenItem[];
  readonly scope: string;
  readonly screen: string;
  readonly onNavigate: (scope: string, screen: string) => void;
  readonly onOpenSearch: () => void;
  readonly onOpenSettings: () => void;
  /** Configurações aberta: o botão do pé da barra lateral fica destacado. */
  readonly settingsActive?: boolean;
  readonly children: React.ReactNode;
  /** Largura imposta, para teste e comparação visual. */
  readonly width?: number | undefined;
};

/** Abaixo disto a barra lateral vira gaveta (prancha 18). */
export const DRAWER_BELOW = 1000;
/** Entre isto e a gaveta, a barra lateral mostra só ícones. */
export const ICONS_BELOW = 1240;

export const AppShell = ({
  portfolios,
  screens,
  scope,
  screen,
  onNavigate,
  onOpenSearch,
  onOpenSettings,
  settingsActive = false,
  children,
  width: forcedWidth,
}: AppShellProps): React.ReactElement => {
  const [viewport, setViewport] = useState(
    () => forcedWidth ?? globalThis.innerWidth ?? 1440,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (forcedWidth !== undefined) return;
    const onResize = (): void => setViewport(globalThis.innerWidth);
    globalThis.addEventListener('resize', onResize);
    return () => globalThis.removeEventListener('resize', onResize);
  }, [forcedWidth]);

  const width = forcedWidth ?? viewport;
  const asDrawer = width < DRAWER_BELOW;
  const iconsOnly = !asDrawer && width < ICONS_BELOW;

  const scopeLabel =
    scope === ALL_PORTFOLIOS
      ? 'Todas as carteiras'
      : (portfolios.find((portfolio) => portfolio.id === scope)?.label ?? 'Carteira');

  const sidebar = (
    <Sidebar
      portfolios={portfolios}
      screens={screens}
      scope={scope}
      scopeLabel={scopeLabel}
      screen={screen}
      iconsOnly={iconsOnly}
      onNavigate={(nextScope, nextScreen) => {
        onNavigate(nextScope, nextScreen);
        setDrawerOpen(false);
      }}
      onOpenSearch={onOpenSearch}
      onOpenSettings={onOpenSettings}
      settingsActive={settingsActive}
    />
  );

  return (
    <div className="flex min-h-screen bg-bg">
      {asDrawer ? (
        <>
          {drawerOpen ? (
            <div className="fixed inset-0 z-40 flex">
              <div className="w-64 border-r border-line bg-panel">{sidebar}</div>
              <button
                type="button"
                aria-label="Fechar a barra lateral"
                className="flex-1 cursor-default bg-overlay"
                onClick={() => setDrawerOpen(false)}
              />
            </div>
          ) : null}
        </>
      ) : (
        <nav
          aria-label="Navegação"
          className={`shrink-0 border-r border-line bg-panel ${iconsOnly ? 'w-14' : 'w-64'}`}
        >
          {sidebar}
        </nav>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {asDrawer ? (
          <div className="border-b border-line bg-panel px-4 py-2">
            <button
              type="button"
              aria-label="Abrir a barra lateral"
              aria-expanded={drawerOpen}
              className="cursor-pointer text-ink-2"
              onClick={() => setDrawerOpen(true)}
            >
              ☰ {scopeLabel}
            </button>
          </div>
        ) : null}
        <main className="min-w-0 flex-1 p-5">{children}</main>
      </div>
    </div>
  );
};

const Sidebar = ({
  portfolios,
  screens,
  scope,
  scopeLabel,
  screen,
  iconsOnly,
  onNavigate,
  onOpenSearch,
  onOpenSettings,
  settingsActive,
}: {
  readonly portfolios: readonly PortfolioItem[];
  readonly screens: readonly ScreenItem[];
  readonly scope: string;
  readonly scopeLabel: string;
  readonly screen: string;
  readonly iconsOnly: boolean;
  readonly onNavigate: (scope: string, screen: string) => void;
  readonly onOpenSearch: () => void;
  readonly onOpenSettings: () => void;
  readonly settingsActive: boolean;
}): React.ReactElement => {
  const list = useRef<HTMLUListElement>(null);

  return (
    <div className="flex h-full flex-col gap-3 p-2">
      <div className="flex items-center gap-2 px-2 pt-1">
        <span
          aria-hidden="true"
          className="grid size-6 place-items-center rounded-xs bg-accent text-accent-ink"
        >
          ▮
        </span>
        {iconsOnly ? null : (
          <span className="tabular text-sm font-semibold">patrimônio</span>
        )}
      </div>

      <button
        type="button"
        className="flex h-control cursor-pointer items-center gap-2 rounded-control border border-line px-2 text-sm text-ink-3 hover:bg-panel-2"
        onClick={onOpenSearch}
      >
        <span aria-hidden="true">⌕</span>
        {iconsOnly ? null : (
          <>
            <span className="flex-1 text-left">Buscar</span>
            <Kbd>⌘K</Kbd>
          </>
        )}
      </button>

      {iconsOnly ? null : (
        <div className="px-2">
          <Label>Carteiras</Label>
        </div>
      )}

      <ul ref={list} className="flex flex-col">
        {portfolios.map((portfolio) => (
          <li key={portfolio.id}>
            <button
              type="button"
              aria-current={portfolio.id === scope ? 'true' : undefined}
              title={portfolio.label}
              className={`flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-control px-2 text-sm ${
                portfolio.id === scope
                  ? 'bg-accent-soft font-medium'
                  : 'text-ink-2 hover:bg-panel-2'
              }`}
              onClick={() => onNavigate(portfolio.id, screen)}
            >
              <span className="truncate">
                {iconsOnly ? portfolio.label.slice(0, 1) : portfolio.label}
              </span>
              {iconsOnly ? null : <Compact value={portfolio.value} />}
            </button>
          </li>
        ))}
      </ul>

      {iconsOnly ? null : (
        <div className="px-2 pt-1">
          <Label>{scopeLabel}</Label>
        </div>
      )}

      <ul className="flex flex-1 flex-col">
        {screens.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-current={item.id === screen ? 'page' : undefined}
              title={item.label}
              className={`flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-control px-2 text-sm ${
                item.id === screen
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-ink-2 hover:bg-panel-2'
              }`}
              onClick={() => onNavigate(scope, item.id)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {iconsOnly ? null : item.label}
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        title="Configurações"
        aria-current={settingsActive ? 'page' : undefined}
        className={`flex h-9 cursor-pointer items-center gap-2.5 rounded-control border-t border-line px-2 text-sm ${
          settingsActive
            ? 'bg-accent-soft font-medium text-accent'
            : 'text-ink-2 hover:bg-panel-2'
        }`}
        onClick={onOpenSettings}
      >
        <span aria-hidden="true">☼</span>
        {iconsOnly ? null : 'Configurações'}
      </button>
    </div>
  );
};
