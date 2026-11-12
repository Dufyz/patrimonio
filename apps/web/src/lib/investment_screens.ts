import type { IconName } from '../components/icon.js';

/**
 * NAV-003 · As telas de Investimentos.
 *
 * Em "Todas as carteiras" existem as que somam carteiras: Visão geral, Posições,
 * Movimentações e Objetivos (o panorama, só leitura). Em uma carteira entram
 * também Estratégia e Objetivo (no singular). O identificador é o caminho.
 */

export type InvestmentScreen = {
  readonly id: string;
  readonly label: string;
  /** O nome no singular quando o escopo é uma carteira. */
  readonly portfolioLabel?: string;
  readonly icon: IconName;
  /** A tela também existe em "Todas as carteiras". */
  readonly consolidated: boolean;
  /** O identificador do atalho `G` + letra. */
  readonly shortcut: string;
};

export const INVESTMENT_SCREENS: readonly InvestmentScreen[] = [
  {
    id: 'visao-geral',
    label: 'Visão geral',
    icon: 'grid',
    consolidated: true,
    shortcut: 'overview',
  },
  {
    id: 'posicoes',
    label: 'Posições',
    icon: 'list',
    consolidated: true,
    shortcut: 'positions',
  },
  {
    id: 'movimentacoes',
    label: 'Movimentações',
    icon: 'swap',
    consolidated: true,
    shortcut: 'transactions',
  },
  {
    id: 'estrategia',
    label: 'Estratégia',
    icon: 'target',
    consolidated: false,
    shortcut: 'strategy',
  },
  {
    id: 'objetivos',
    label: 'Objetivos',
    portfolioLabel: 'Objetivo',
    icon: 'flag',
    consolidated: true,
    shortcut: 'goals',
  },
];

/** As telas que existem no escopo, com o nome certo para ele. */
export const screensForScope = (all: boolean): readonly InvestmentScreen[] =>
  (all
    ? INVESTMENT_SCREENS.filter((screen) => screen.consolidated)
    : INVESTMENT_SCREENS
  ).map((screen) => ({
    ...screen,
    label: all ? screen.label : (screen.portfolioLabel ?? screen.label),
  }));

/**
 * A tela do escopo que corresponde a outra: a página do ativo vale Posições, e
 * uma tela que não existe no escopo cai na Visão geral.
 */
export const screenInScope = (screenId: string, all: boolean): string => {
  const wanted = screenId === 'ativo' ? 'posicoes' : screenId;
  return screensForScope(all).some((screen) => screen.id === wanted)
    ? wanted
    : 'visao-geral';
};
