import { ALL_SCOPE } from './scope.js';

/**
 * NAV-01 · Todo caminho do app é montado aqui.
 *
 * A URL diz a tela e a carteira, sem prefixo de área:
 *
 * - `/` é a Visão geral, com `escopo=tudo|fluxo|investimentos` e
 *   `carteira=todas|<apelido>` na consulta;
 * - as telas de fluxo são planas: `/lancamentos`, `/contas`, `/cartoes`,
 *   `/recorrentes`, `/categorias`, e os detalhes `/contas/<id>`, `/cartoes/<id>`;
 * - as telas de carteira moram sob o escopo: `/carteiras/<todas|apelido>/<tela>` e
 *   a página do ativo em `/carteiras/<escopo>/ativos/<apelido>`;
 * - `/configuracoes`.
 *
 * Nenhum componente escreve um caminho à mão. Tela, carteira e período vivem na
 * URL: voltar, favoritos e nova aba preservam a seleção.
 */

export const HOME_SCOPES = ['tudo', 'fluxo', 'investimentos'] as const;
export type HomeScope = (typeof HOME_SCOPES)[number];

export const FLOW_SCREENS = [
  'lancamentos',
  'contas',
  'cartoes',
  'recorrentes',
  'categorias',
] as const;
export type FlowScreen = (typeof FLOW_SCREENS)[number];

export const PORTFOLIOS_ROOT = '/carteiras';

const withSearch = (path: string, search?: string): string =>
  search === undefined || search === '' ? path : `${path}?${search}`;

export const routes = {
  /** A Visão geral. `tudo` é o padrão e não aparece na URL. */
  home: (scope: HomeScope = 'tudo', portfolio?: string): string => {
    const params = new URLSearchParams();
    if (scope !== 'tudo') params.set('escopo', scope);
    if (scope === 'investimentos' && portfolio !== undefined && portfolio !== ALL_SCOPE) {
      params.set('carteira', portfolio);
    }
    return withSearch('/', params.toString());
  },
  settings: (): string => '/configuracoes',
  /** Uma tela de carteira no escopo (`todas` ou o apelido). */
  portfolio: (scope: string = ALL_SCOPE, screen = 'posicoes'): string =>
    screen === 'visao-geral'
      ? routes.home('investimentos', scope)
      : `${PORTFOLIOS_ROOT}/${scope}/${screen}`,
  asset: (scope: string, slug: string): string =>
    `${PORTFOLIOS_ROOT}/${scope}/ativos/${encodeURIComponent(slug)}`,
} as const;

export type Place =
  | {
      readonly kind: 'home';
      readonly scope: HomeScope;
      /** `todas` ou o apelido da carteira (só vale em `investimentos`). */
      readonly portfolio: string;
    }
  | { readonly kind: 'flow'; readonly screen: FlowScreen; readonly detail?: string }
  | {
      readonly kind: 'portfolios';
      readonly scope: string;
      /** `posicoes`, `estrategia`… ou `ativo` na página de um ativo. */
      readonly screen: string;
    }
  | { readonly kind: 'settings' }
  | { readonly kind: 'unknown' };

const isFlowScreen = (value: string | undefined): value is FlowScreen =>
  (FLOW_SCREENS as readonly string[]).includes(value ?? '');

/** Onde a URL de agora está. Caminho desconhecido dá `unknown`. */
export const placeForPath = (pathname: string, search = ''): Place => {
  const parts = pathname.split('/').filter((part) => part !== '');
  const first = parts[0];

  if (first === undefined) {
    const params = new URLSearchParams(search);
    const wanted = params.get('escopo');
    // Escopo inválido cai na Visão geral (NAV-01).
    const scope = (HOME_SCOPES as readonly string[]).includes(wanted ?? '')
      ? (wanted as HomeScope)
      : 'tudo';
    return {
      kind: 'home',
      scope,
      portfolio:
        scope === 'investimentos' ? (params.get('carteira') ?? ALL_SCOPE) : ALL_SCOPE,
    };
  }
  if (isFlowScreen(first)) {
    return parts[1] === undefined
      ? { kind: 'flow', screen: first }
      : { kind: 'flow', screen: first, detail: decodeURIComponent(parts[1]) };
  }
  if (first === 'carteiras') {
    const scope = parts[1] ?? ALL_SCOPE;
    return {
      kind: 'portfolios',
      scope,
      screen: parts[2] === 'ativos' ? 'ativo' : (parts[2] ?? 'posicoes'),
    };
  }
  if (first === 'configuracoes') return { kind: 'settings' };
  return { kind: 'unknown' };
};

/** O item da barra lateral que fica destacado para o lugar (NAV-06). */
export const navIdForPlace = (place: Place): string | null => {
  switch (place.kind) {
    case 'home':
      return 'visao-geral';
    case 'flow':
      return place.screen;
    case 'portfolios':
      // A página do ativo pertence a Posições.
      return place.screen === 'ativo' ? 'posicoes' : place.screen;
    case 'settings':
      return 'configuracoes';
    case 'unknown':
      return null;
  }
};
