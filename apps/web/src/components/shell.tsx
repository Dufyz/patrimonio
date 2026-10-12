import { useEffect, useState } from 'react';

import { Compact } from './number.js';
import { Icon } from './icon.js';
import { Kbd } from './primitives.js';

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

/** O identificador de "Todas as carteiras" na barra lateral e na paleta. */
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
  /** Há dado de demonstração no banco: a barra lateral diz isso. */
  readonly demo?: boolean;
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
  demo = false,
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
      demo={demo}
    />
  );

  return (
    <div className="flex min-h-dvh bg-bg">
      {asDrawer ? (
        <>
          {drawerOpen ? (
            <div className="fixed inset-0 z-40 flex">
              <div className="h-dvh w-64 border-r border-line bg-panel">{sidebar}</div>
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
        /*
         * A barra lateral tem a altura da janela e fica presa ao topo: a página
         * rola, ela não. Sem isso ela crescia com o conteúdo e o botão de
         * Configurações, no pé dela, ia parar no fim de uma tabela comprida.
         */
        <nav
          aria-label="Navegação"
          className={`sticky top-0 h-dvh shrink-0 self-start border-r border-line bg-panel ${
            iconsOnly ? 'w-14' : 'w-[248px]'
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
              {scopeLabel}
            </button>
          </div>
        ) : null}
        <main className="min-w-0 flex-1 px-7 pt-5 pb-10">{children}</main>
      </div>
    </div>
  );
};

const NAV_BASE =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-[7px] text-left text-[0.84375rem] outline-none focus-visible:ring-2 focus-visible:ring-focus/40';

/** O título de bloco da barra lateral: mono 10,5, peso 600, caixa alta. */
const GroupTitle = ({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement => (
  <div
    className={`tabular flex items-center gap-2 px-2.5 pt-2 pb-1.5 text-label font-semibold tracking-[0.1em] text-ink-3 uppercase ${className ?? ''}`}
  >
    {children}
  </div>
);

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
  demo,
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
  readonly demo: boolean;
}): React.ReactElement => (
  <div className="flex h-full flex-col px-3 pt-3.5 pb-3">
    {demo ? (
      <p
        role="note"
        title="O banco tem dados de demonstração. Rode pnpm demo:remove para apagá-los."
        className="tabular mx-2 mb-2 rounded-control bg-attention-soft px-2 py-1 text-center text-label font-semibold tracking-[0.08em] uppercase"
      >
        {iconsOnly ? 'demo' : 'Demonstração'}
      </p>
    ) : null}

    <button
      type="button"
      aria-label="Buscar"
      className="mb-1.5 inline-flex h-control w-full cursor-pointer items-center justify-between gap-2 rounded-control border border-line-2 bg-panel px-[11px] text-[0.78125rem] font-medium text-ink-3 hover:bg-panel-2"
      onClick={onOpenSearch}
    >
      <span className="flex items-center gap-2">
        <Icon name="search" />
        {iconsOnly ? null : 'Buscar'}
      </span>
      {iconsOnly ? null : <Kbd>⌘K</Kbd>}
    </button>

    {/* Só esta região rola: a busca e Configurações ficam onde estão. */}
    <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
      {iconsOnly ? null : <GroupTitle>Carteiras</GroupTitle>}

      <ul className="flex flex-col gap-px">
        {portfolios.map((portfolio) => (
          <li key={portfolio.id}>
            <button
              type="button"
              aria-current={portfolio.id === scope ? 'true' : undefined}
              title={portfolio.label}
              className={`${NAV_BASE} min-h-9 justify-between py-1.5 ${
                portfolio.id === scope
                  ? 'bg-accent-soft font-semibold text-ink'
                  : 'text-ink hover:bg-panel-2'
              }`}
              onClick={() => onNavigate(portfolio.id, screen)}
            >
              <span className="min-w-0 flex-1 truncate">
                {iconsOnly ? portfolio.label.slice(0, 1) : portfolio.label}
              </span>
              {iconsOnly ? null : (
                <span className="text-xs font-normal text-ink-3">
                  <Compact value={portfolio.value} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {iconsOnly ? (
        <div className="mt-2.5 border-t border-line pt-2" />
      ) : (
        <GroupTitle className="mt-2.5 truncate border-t border-line pt-4">
          {scopeLabel}
        </GroupTitle>
      )}

      <ul className="flex flex-col gap-0.5">
        {screens.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-current={item.id === screen ? 'page' : undefined}
              title={item.label}
              className={`${NAV_BASE} ${
                item.id === screen
                  ? 'bg-accent-soft font-medium text-ink'
                  : 'text-ink-2 hover:bg-panel-2 hover:text-ink'
              }`}
              onClick={() => onNavigate(scope, item.id)}
            >
              <span
                aria-hidden="true"
                className={item.id === screen ? 'text-accent' : undefined}
              >
                {item.icon}
              </span>
              {iconsOnly ? null : item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>

    <div className="mt-2 border-t border-line pt-2">
      <button
        type="button"
        title="Configurações"
        aria-current={settingsActive ? 'page' : undefined}
        className={`${NAV_BASE} ${
          settingsActive
            ? 'bg-accent-soft font-medium text-ink'
            : 'text-ink-2 hover:bg-panel-2 hover:text-ink'
        }`}
        onClick={onOpenSettings}
      >
        <span className={settingsActive ? 'text-accent' : undefined}>
          <Icon name="settings" />
        </span>
        {iconsOnly ? null : 'Configurações'}
      </button>
    </div>
  </div>
);
