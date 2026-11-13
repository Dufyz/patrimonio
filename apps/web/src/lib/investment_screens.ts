import type { IconName } from '../components/icon.js';

/**
 * NAV-03 · As telas de carteira.
 *
 * A barra lateral lista Posições, Estratégia, Objetivos e Projeção. Em "Todas as
 * carteiras" a Estratégia não existe e Objetivos é o panorama, só leitura; em
 * uma carteira entram a Estratégia e o Objetivo (no singular). O identificador é
 * o caminho.
 *
 * Visão geral (escopo Investimentos da raiz) segue roteável, mas fora da barra:
 * vira o painel da Visão geral unificada. O endereço antigo de Movimentações
 * redireciona para Lançamentos (LAN-21).
 */

export type InvestmentScreen = {
  readonly id: string;
  readonly label: string;
  /** O nome no singular quando o escopo é uma carteira. */
  readonly portfolioLabel?: string;
  readonly icon: IconName;
  /** A tela também existe em "Todas as carteiras". */
  readonly consolidated: boolean;
  /** Aparece na barra lateral. */
  readonly sidebar: boolean;
  /** O identificador do atalho `G` + letra. */
  readonly shortcut: string;
};

export const INVESTMENT_SCREENS: readonly InvestmentScreen[] = [
  {
    id: 'visao-geral',
    sidebar: false,
    label: 'Visão geral',
    icon: 'grid',
    consolidated: true,
    shortcut: 'overview',
  },
  {
    id: 'posicoes',
    sidebar: true,
    label: 'Posições',
    icon: 'list',
    consolidated: true,
    shortcut: 'positions',
  },
  {
    id: 'estrategia',
    sidebar: true,
    label: 'Estratégia',
    icon: 'target',
    consolidated: false,
    shortcut: 'strategy',
  },
  {
    id: 'objetivos',
    sidebar: true,
    label: 'Objetivos',
    portfolioLabel: 'Objetivo',
    icon: 'flag',
    consolidated: true,
    shortcut: 'goals',
  },
  {
    id: 'projecao',
    sidebar: true,
    label: 'Projeção',
    icon: 'growth',
    consolidated: true,
    shortcut: 'projection',
  },
];

const inScope = (all: boolean): readonly InvestmentScreen[] =>
  (all
    ? INVESTMENT_SCREENS.filter((screen) => screen.consolidated)
    : INVESTMENT_SCREENS
  ).map((screen) => ({
    ...screen,
    label: all ? screen.label : (screen.portfolioLabel ?? screen.label),
  }));

/** As telas da barra lateral no escopo, com o nome certo para ele. */
export const screensForScope = (all: boolean): readonly InvestmentScreen[] =>
  inScope(all).filter((screen) => screen.sidebar);

/** Todas as telas que a URL pode abrir no escopo, inclusive as fora da barra. */
export const routableScreens = (all: boolean): readonly InvestmentScreen[] =>
  inScope(all);

/**
 * NAV-04 · A tela do escopo que corresponde a outra: a página do ativo vale
 * Posições, e uma tela que não existe no escopo cai na Visão geral do escopo.
 */
export const screenInScope = (screenId: string, all: boolean): string => {
  const wanted = screenId === 'ativo' ? 'posicoes' : screenId;
  return screensForScope(all).some((screen) => screen.id === wanted)
    ? wanted
    : 'visao-geral';
};
