import { Fragment, useEffect, useState } from 'react';

import { Compact } from './number.js';
import { Icon } from './icon.js';
import type { IconName } from './icon.js';
import { Kbd } from './primitives.js';
import { browserStorage, readRaw, writeRaw } from '../lib/preferences.js';

/**
 * NAV-002 · A casca única do app.
 *
 * Uma só barra lateral serve as três áreas. De cima para baixo: o nome
 * "Patrimônio" (só texto) e o botão de recolher; a busca; GERAL; INVESTIMENTOS
 * — com o seletor de carteiras e as telas do escopo escolhido —; FINANÇAS; e
 * Configurações no pé. As três áreas ficam sempre à vista: não existe seletor de
 * área para trocar de uma para a outra.
 *
 * A área, o escopo e a tela vivem na URL, e não em estado: voltar, avançar e
 * abrir em nova aba preservam a seleção. Trocar de carteira mantém a tela
 * atual, porque quem troca está comparando, não recomeçando — quem decide o
 * destino de cada item é `AppLayout`, que entrega aqui o caminho pronto.
 */

/** O identificador de "Todas as carteiras" na barra lateral e na paleta. */
export const ALL_PORTFOLIOS = 'todas';

export type NavEntry = {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly path: string;
};

export type PortfolioEntry = {
  readonly id: string;
  readonly label: string;
  readonly value: string | null;
  readonly path: string;
};

/** Onde a pessoa está, para destacar um único item. */
export type ShellActive =
  | { readonly area: 'geral' }
  | { readonly area: 'financas'; readonly screen: string }
  | { readonly area: 'investimentos'; readonly scope: string; readonly screen: string }
  | { readonly area: 'configuracoes' };

export type AppShellProps = {
  readonly geral: NavEntry;
  readonly finance: readonly NavEntry[];
  readonly portfolios: readonly PortfolioEntry[];
  /** As telas de Investimentos do escopo atual (ou do último escopo usado). */
  readonly screens: readonly NavEntry[];
  readonly active: ShellActive;
  /** O título da tela de agora, para a gaveta. */
  readonly title: string;
  readonly settingsPath: string;
  readonly onGo: (path: string) => void;
  readonly onOpenSearch: () => void;
  /** Há dado de demonstração no banco: a barra lateral diz isso. */
  readonly demo?: boolean;
  readonly children: React.ReactNode;
  /** Largura imposta, para teste e comparação visual. */
  readonly width?: number | undefined;
};

/** Abaixo disto a barra lateral vira gaveta (NAV-005). */
export const DRAWER_BELOW = 1000;
/** Entre isto e a gaveta, a barra lateral mostra só ícones. */
export const ICONS_BELOW = 1240;

const COLLAPSED_KEY = 'patrimonio:sidebar-collapsed';

const readCollapsed = (): boolean => readRaw(browserStorage(), COLLAPSED_KEY) === '1';

const writeCollapsed = (value: boolean): void =>
  writeRaw(browserStorage(), COLLAPSED_KEY, value ? '1' : '0');

export const AppShell = ({
  geral,
  finance,
  portfolios,
  screens,
  active,
  title,
  settingsPath,
  onGo,
  onOpenSearch,
  demo = false,
  children,
  width: forcedWidth,
}: AppShellProps): React.ReactElement => {
  const [viewport, setViewport] = useState(
    () => forcedWidth ?? globalThis.innerWidth ?? 1440,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    if (forcedWidth !== undefined) return;
    const onResize = (): void => setViewport(globalThis.innerWidth);
    globalThis.addEventListener('resize', onResize);
    return () => globalThis.removeEventListener('resize', onResize);
  }, [forcedWidth]);

  const width = forcedWidth ?? viewport;
  const asDrawer = width < DRAWER_BELOW;
  // A pessoa recolhe a barra quando quer; em janela estreita ela vira trilho
  // sozinha. Na gaveta o recolhimento não se aplica. O estado vale para as três
  // áreas, porque a barra é uma só.
  const iconsOnly = !asDrawer && (collapsed || width < ICONS_BELOW);

  const sidebar = (
    <Sidebar
      geral={geral}
      finance={finance}
      portfolios={portfolios}
      screens={screens}
      active={active}
      settingsPath={settingsPath}
      iconsOnly={iconsOnly}
      demo={demo}
      onGo={(path) => {
        onGo(path);
        setDrawerOpen(false);
      }}
      onOpenSearch={onOpenSearch}
      onToggleCollapsed={
        asDrawer
          ? undefined
          : () =>
              setCollapsed((current) => {
                const next = !(current || width < ICONS_BELOW);
                writeCollapsed(next);
                return next;
              })
      }
    />
  );

  return (
    <div className="flex min-h-dvh bg-bg">
      {asDrawer ? (
        drawerOpen ? (
          <div className="fixed inset-0 z-40 flex">
            <nav
              aria-label="Navegação"
              className="h-dvh w-64 border-r border-line bg-panel"
            >
              {sidebar}
            </nav>
            <button
              type="button"
              aria-label="Fechar a barra lateral"
              className="flex-1 cursor-pointer bg-overlay"
              onClick={() => setDrawerOpen(false)}
            />
          </div>
        ) : null
      ) : (
        /*
         * A barra lateral tem a altura da janela e fica presa ao topo: a página
         * rola, ela não. Sem isso ela crescia com o conteúdo e o botão de
         * Configurações, no pé dela, ia parar no fim de uma tabela comprida.
         */
        <nav
          aria-label="Navegação"
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
              {title}
            </button>
          </div>
        ) : null}
        <main className="min-w-0 flex-1 px-7 pt-5 pb-10">{children}</main>
      </div>
    </div>
  );
};

/** `GL` para todas as carteiras, as duas primeiras letras nas demais. */
const initials = (id: string, label: string): string =>
  id === ALL_PORTFOLIOS ? 'GL' : label.slice(0, 2).toUpperCase();

const NAV_BASE =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-[7px] text-left text-[0.84375rem] outline-none focus-visible:ring-2 focus-visible:ring-focus/40';

/** O item do trilho recolhido: 40 × 36, centralizado. */
const RAIL_BASE =
  'flex h-9 w-10 cursor-pointer items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-focus/40';

const ACTIVE = 'bg-nav-active font-medium text-ink';
const IDLE = 'text-ink-2 hover:bg-panel-2 hover:text-ink';

/** O título de bloco da barra lateral: mono 10,5, peso 600, caixa alta. */
const GroupTitle = ({
  children,
  first = false,
}: {
  readonly children: React.ReactNode;
  readonly first?: boolean;
}): React.ReactElement => (
  <h3
    className={`tabular flex items-center gap-2 px-2.5 pt-2 pb-1.5 text-label font-semibold tracking-[0.1em] text-ink-3 uppercase ${
      first ? '' : 'mt-2.5 border-t border-line pt-4'
    }`}
  >
    {children}
  </h3>
);

const Divider = (): React.ReactElement => (
  <div className="my-2 w-8 border-t border-line" />
);

const NavButton = ({
  entry,
  current,
  iconsOnly,
  onGo,
}: {
  readonly entry: NavEntry;
  readonly current: boolean;
  readonly iconsOnly: boolean;
  readonly onGo: (path: string) => void;
}): React.ReactElement => (
  <button
    type="button"
    title={entry.label}
    aria-current={current ? 'page' : undefined}
    className={`${iconsOnly ? RAIL_BASE : NAV_BASE} ${current ? ACTIVE : IDLE}`}
    onClick={() => onGo(entry.path)}
  >
    <span aria-hidden="true" className={current ? 'text-accent' : undefined}>
      <Icon name={entry.icon} />
    </span>
    {iconsOnly ? null : entry.label}
  </button>
);

const Sidebar = ({
  geral,
  finance,
  portfolios,
  screens,
  active,
  settingsPath,
  iconsOnly,
  demo,
  onGo,
  onOpenSearch,
  onToggleCollapsed,
}: {
  readonly geral: NavEntry;
  readonly finance: readonly NavEntry[];
  readonly portfolios: readonly PortfolioEntry[];
  readonly screens: readonly NavEntry[];
  readonly active: ShellActive;
  readonly settingsPath: string;
  readonly iconsOnly: boolean;
  readonly demo: boolean;
  readonly onGo: (path: string) => void;
  readonly onOpenSearch: () => void;
  readonly onToggleCollapsed?: (() => void) | undefined;
}): React.ReactElement => {
  const inInvestments = active.area === 'investimentos';
  const settingsActive = active.area === 'configuracoes';

  return (
    <div
      className={`flex h-full flex-col pt-3.5 pb-3 ${iconsOnly ? 'items-center px-0' : 'px-3'}`}
    >
      {demo ? (
        <p
          role="note"
          title="O banco tem dados de demonstração. Rode pnpm demo:remove para apagá-los."
          className="tabular mx-2 mb-2 rounded-control bg-attention-soft px-2 py-1 text-center text-label font-semibold tracking-[0.08em] uppercase"
        >
          {iconsOnly ? 'demo' : 'Demonstração'}
        </p>
      ) : null}

      <div
        className={`flex items-center ${
          iconsOnly ? 'mb-1 justify-center' : 'justify-between pr-1 pb-3 pl-1.5'
        }`}
      >
        {iconsOnly ? null : (
          <span className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
            Patrimônio
          </span>
        )}
        {onToggleCollapsed === undefined ? null : (
          <button
            type="button"
            aria-label={iconsOnly ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            title={iconsOnly ? 'Expandir barra lateral' : 'Recolher barra lateral'}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-panel-2 hover:text-ink"
            onClick={onToggleCollapsed}
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

      {/* Só esta região rola: a busca e Configurações ficam onde estão. */}
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${
          iconsOnly ? 'items-center' : '-mx-1 px-1'
        }`}
      >
        <section
          aria-label="Geral"
          className={iconsOnly ? 'flex flex-col items-center' : ''}
        >
          {iconsOnly ? null : <GroupTitle first>Geral</GroupTitle>}
          <NavButton
            entry={geral}
            current={active.area === 'geral'}
            iconsOnly={iconsOnly}
            onGo={onGo}
          />
        </section>

        <section
          aria-label="Investimentos"
          className={iconsOnly ? 'flex flex-col items-center' : ''}
        >
          {iconsOnly ? <Divider /> : <GroupTitle>Investimentos</GroupTitle>}
          <ul className="flex flex-col gap-px">
            {portfolios.map((portfolio) => {
              const current =
                active.area === 'investimentos' && active.scope === portfolio.id;
              return (
                <li key={portfolio.id}>
                  <button
                    type="button"
                    aria-current={current ? 'true' : undefined}
                    title={portfolio.label}
                    className={`${iconsOnly ? RAIL_BASE : `${NAV_BASE} min-h-9 justify-between py-1.5`} ${
                      current
                        ? 'bg-accent-soft font-semibold text-ink'
                        : 'text-ink hover:bg-panel-2'
                    }`}
                    onClick={() => onGo(portfolio.path)}
                  >
                    <span
                      className={
                        iconsOnly
                          ? 'tabular text-[0.6875rem] font-semibold'
                          : 'min-w-0 flex-1 truncate'
                      }
                    >
                      {iconsOnly
                        ? initials(portfolio.id, portfolio.label)
                        : portfolio.label}
                    </span>
                    {iconsOnly ? null : (
                      <span className="text-xs font-normal text-ink-3">
                        <Compact value={portfolio.value} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {iconsOnly ? <Divider /> : <div className="mt-2 border-t border-line pt-2" />}

          <ul className="flex flex-col gap-0.5">
            {screens.map((entry) => (
              <Fragment key={entry.id}>
                <li>
                  <NavButton
                    entry={entry}
                    current={inInvestments && active.screen === entry.id}
                    iconsOnly={iconsOnly}
                    onGo={onGo}
                  />
                </li>
              </Fragment>
            ))}
          </ul>
        </section>

        <section
          aria-label="Finanças"
          className={iconsOnly ? 'flex flex-col items-center' : ''}
        >
          {iconsOnly ? <Divider /> : <GroupTitle>Finanças</GroupTitle>}
          <ul className="flex flex-col gap-0.5">
            {finance.map((entry) => (
              <li key={entry.id}>
                <NavButton
                  entry={entry}
                  current={active.area === 'financas' && active.screen === entry.id}
                  iconsOnly={iconsOnly}
                  onGo={onGo}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-2 border-t border-line pt-2">
        <button
          type="button"
          title="Configurações"
          aria-current={settingsActive ? 'page' : undefined}
          className={`${iconsOnly ? RAIL_BASE : NAV_BASE} ${settingsActive ? ACTIVE : IDLE}`}
          onClick={() => onGo(settingsPath)}
        >
          <span className={settingsActive ? 'text-accent' : undefined}>
            <Icon name="settings" />
          </span>
          {iconsOnly ? null : 'Configurações'}
        </button>
      </div>
    </div>
  );
};
