import { ALL_SCOPE } from './scope.js';

/**
 * NAV-001 · Todo caminho do app é montado aqui.
 *
 * A URL diz a área e o escopo: `/geral`, `/financas/<tela>`,
 * `/investimentos/<escopo>/<tela>` (escopo é `todas` ou o apelido da carteira)
 * e `/configuracoes`. Nenhum componente escreve um caminho à mão.
 */

export const AREAS = ['geral', 'financas', 'investimentos'] as const;
export type AreaId = (typeof AREAS)[number];

export const INVESTMENTS_ROOT = '/investimentos';
export const FINANCE_ROOT = '/financas';

export const routes = {
  home: (): string => '/geral',
  geral: (): string => '/geral',
  settings: (): string => '/configuracoes',
  investments: (scope: string = ALL_SCOPE, screen = 'visao-geral'): string =>
    `${INVESTMENTS_ROOT}/${scope}/${screen}`,
  asset: (scope: string, slug: string): string =>
    `${INVESTMENTS_ROOT}/${scope}/ativo/${slug}`,
} as const;

export type Place =
  | { readonly area: 'geral' }
  | { readonly area: 'financas'; readonly screen: string }
  | {
      readonly area: 'investimentos';
      readonly scope: string;
      /** `visao-geral`, `posicoes`… ou `ativo` na página de um ativo. */
      readonly screen: string;
    }
  | { readonly area: 'configuracoes' };

/** Onde a URL de agora está. Caminho desconhecido cai em Geral. */
export const placeForPath = (pathname: string): Place => {
  const parts = pathname.split('/').filter((part) => part !== '');
  switch (parts[0]) {
    case 'financas':
      return { area: 'financas', screen: parts[1] ?? 'visao-geral' };
    case 'investimentos':
      return {
        area: 'investimentos',
        scope: parts[1] ?? ALL_SCOPE,
        screen: parts[2] ?? 'visao-geral',
      };
    case 'configuracoes':
      return { area: 'configuracoes' };
    default:
      return { area: 'geral' };
  }
};
