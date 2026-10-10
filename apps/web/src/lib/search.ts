import type {
  SearchAsset,
  SearchResource,
  SearchTransaction,
} from '@patrimonio/contracts';

import {
  PAYOUT_KIND_LABELS,
  TRANSACTION_KIND_LABELS,
  assetSlug,
  assetTitle,
} from './asset_page.js';
import { formatQuantity } from './format.js';
import { formatDate } from './overview.js';
import { readJson, writeJson } from './preferences.js';
import type { Storageish } from './preferences.js';

/**
 * T-09 · O que a busca global decide por conta própria.
 *
 * A paleta junta duas fontes com velocidades diferentes. **Tela, carteira e
 * ação** o navegador já tem, e por isso aparecem na hora, sem pedido nenhum:
 * é o que faz a paleta abrir em menos de cem milissegundos com a base cheia —
 * o tamanho da base não entra na conta de abrir. **Ativo e lançamento** moram
 * no banco e chegam depois, da `api`, já na ordem certa dentro de cada grupo.
 *
 * Tudo aqui é função pura, de propósito: "qual grupo vem primeiro" e "qual item
 * fica marcado" são as decisões em que a busca erra, e função pura se testa
 * sem montar tela. Nenhuma função soma dinheiro nem refaz a ordem que a `api`
 * deu a ativos e lançamentos.
 */

export const SEARCH_DEBOUNCE_MS = 90;
export const RECENT_LIMIT = 5;
export const RECENT_STORAGE_KEY = 'patrimonio.search.recent';

/** Quando a ação existe na paleta mas a tela que a executa ainda não chegou. */
export const ACTION_PENDING_REASON = 'chega com T-10';

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */

export type SearchGroupId =
  'recent' | 'assets' | 'asset_actions' | 'transactions' | 'screens' | 'actions';

/** A ordem de desempate quando dois grupos são igualmente prováveis. */
const CANONICAL_ORDER: readonly SearchGroupId[] = [
  'recent',
  'assets',
  'asset_actions',
  'transactions',
  'screens',
  'actions',
];

export const GROUP_TITLES: Readonly<Record<SearchGroupId, string>> = {
  recent: 'Recentes',
  assets: 'Ativos',
  // O título real leva o código do ativo; ver `assetActionItems`.
  asset_actions: 'Ações com o ativo',
  transactions: 'Lançamentos',
  screens: 'Ir para',
  actions: 'Ações',
};

export type SearchActionId =
  'new_transaction' | 'buy_asset' | 'payout_asset' | 'move_asset';

/**
 * Os glifos são os da barra lateral e do resto da aplicação: um ícone que muda
 * de forma entre a barra e a paleta faz a mesma tela parecer duas.
 */
export const GLYPHS = {
  portfolio: '▢',
  asset: '◈',
  transaction: '⇄',
  action: '+',
} as const;

export type SearchTarget =
  | { readonly kind: 'screen'; readonly screen: string }
  | { readonly kind: 'portfolio'; readonly portfolioId: string }
  | { readonly kind: 'asset'; readonly assetId: string; readonly slug: string }
  | {
      readonly kind: 'transaction';
      readonly transactionId: string;
      /** O que o extrato filtra para mostrar este lançamento no meio dos outros. */
      readonly search: string | null;
    }
  | {
      readonly kind: 'action';
      readonly action: SearchActionId;
      readonly assetId?: string;
      /** O título do ativo, como a tela o escreve. */
      readonly title?: string;
    };

export type SearchItem = {
  readonly id: string;
  readonly group: SearchGroupId;
  readonly glyph: string;
  readonly label: string;
  /** O que acompanha o nome, em cinza: a instituição, a data, a carteira. */
  readonly detail: string | null;
  /** Valor em reais à direita, quando o item tem um. */
  readonly amount: string | null;
  /** Atalho que o item mostra, e só se ele existir de verdade. */
  readonly shortcut: string | null;
  /** Palavras que também achariam o item, além do rótulo. */
  readonly keywords: readonly string[];
  readonly target: SearchTarget;
  /** O motivo, quando o item aparece mas ainda não pode ser executado. */
  readonly disabled: string | null;
};

export type SearchSection = {
  readonly group: SearchGroupId;
  readonly title: string;
  readonly items: readonly SearchItem[];
};

export type SearchScreen = {
  readonly id: string;
  readonly label: string;
  readonly glyph: string;
  /** `G V`, quando o atalho existe. */
  readonly shortcut: string | null;
};

export type SearchPortfolio = { readonly id: string; readonly label: string };

/* -------------------------------------------------------------------------- */
/* Texto                                                                      */

/**
 * Minúscula e sem acento: quem digita "acoes" procura "Ações", e quem digita
 * "itau" procura "Itaú". A `api` compara do mesmo jeito, e é isso que mantém a
 * ordem que ela devolveu coerente com a pontuação daqui.
 */
export const normalize = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const SCORE_EXACT = 100;
const SCORE_PREFIX = 80;
const SCORE_WORD_PREFIX = 60;
const SCORE_CONTAINS = 40;

/** Quanto o texto casa com o que foi digitado: 0 é "não casa". */
export const scoreText = (text: string, query: string): number => {
  const haystack = normalize(text);
  const needle = normalize(query);
  if (needle === '' || haystack === '') return 0;

  if (haystack === needle) return SCORE_EXACT;
  if (haystack.startsWith(needle)) return SCORE_PREFIX;
  if (haystack.split(/[\s·\-_/.]+/).some((word) => word.startsWith(needle))) {
    return SCORE_WORD_PREFIX;
  }
  return haystack.includes(needle) ? SCORE_CONTAINS : 0;
};

export const scoreItem = (item: SearchItem, query: string): number =>
  Math.max(
    scoreText(item.label, query),
    ...item.keywords.map((keyword) => scoreText(keyword, query)),
  );

/* -------------------------------------------------------------------------- */
/* Itens locais: telas, carteiras e ações                                     */

/**
 * Sinônimos de tela. Ninguém lembra que a decomposição do retorno mora em
 * Desempenho; mas quase todo mundo digita "rentabilidade".
 */
const SCREEN_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  visao: ['patrimonio', 'resumo', 'inicio', 'painel'],
  posicoes: ['carteira', 'ativos', 'papeis', 'investimentos'],
  movimentacoes: ['extrato', 'lancamentos', 'transacoes', 'historico', 'operacoes'],
  desempenho: ['rentabilidade', 'retorno', 'benchmark', 'cdi', 'ibov', 'ipca'],
  estrategia: ['alocacao', 'alvo', 'rebalanceamento', 'distribuicao'],
  objetivos: ['metas', 'aposentadoria', 'sonhos'],
};

export const localItems = (input: {
  readonly screens: readonly SearchScreen[];
  readonly portfolios: readonly SearchPortfolio[];
  /** Quais ações já têm tela que as execute. As demais aparecem desativadas. */
  readonly readyActions: ReadonlySet<SearchActionId>;
}): readonly SearchItem[] => [
  ...input.screens.map((screen): SearchItem => ({
    id: `screen:${screen.id}`,
    group: 'screens',
    glyph: screen.glyph,
    label: screen.label,
    detail: null,
    amount: null,
    shortcut: screen.shortcut,
    keywords: SCREEN_KEYWORDS[screen.id] ?? [],
    target: { kind: 'screen', screen: screen.id },
    disabled: null,
  })),
  {
    id: 'action:new_transaction',
    group: 'actions',
    glyph: GLYPHS.action,
    label: 'Novo lançamento',
    detail: null,
    amount: null,
    shortcut: 'N',
    keywords: ['comprar', 'vender', 'aporte', 'provento', 'registrar', 'lancar'],
    target: { kind: 'action', action: 'new_transaction' },
    disabled: input.readyActions.has('new_transaction') ? null : ACTION_PENDING_REASON,
  },
  ...input.portfolios.map((portfolio): SearchItem => ({
    id: `portfolio:${portfolio.id}`,
    group: 'actions',
    glyph: GLYPHS.portfolio,
    label: `Ir para ${portfolio.label}`,
    detail: null,
    amount: null,
    shortcut: null,
    keywords: ['carteira', portfolio.label],
    target: { kind: 'portfolio', portfolioId: portfolio.id },
    disabled: null,
  })),
];

/* -------------------------------------------------------------------------- */
/* Itens do banco: ativos e lançamentos                                       */

/** "500 em Longo prazo", "100 em Longo prazo, Reserva", "100 em 3 carteiras". */
export const holdingLabel = (asset: SearchAsset): string => {
  const holding = asset.holding;
  if (holding === null) return 'sem posição';

  const names = holding.portfolio_names;
  const where = names.length <= 2 ? names.join(', ') : `${names.length} carteiras`;

  return `${formatQuantity(holding.quantity).body} em ${where}`;
};

const naming = (asset: SearchAsset) => ({
  asset_id: asset.id,
  ticker: asset.ticker,
  name: asset.name,
  b3_type: asset.b3_type,
});

/**
 * Como a tela escreve o ativo: o código quando ele tem um que alguém reconhece,
 * o nome quando não tem. `CDB-BANCOC-20280614` é chave de banco de dados, e
 * ninguém procura um título por ela.
 */
export const assetName = (asset: SearchAsset): string => assetTitle(naming(asset));

export const assetItems = (assets: readonly SearchAsset[]): readonly SearchItem[] =>
  assets.map((asset): SearchItem => {
    const title = assetName(asset);

    return {
      id: `asset:${asset.id}`,
      group: 'assets',
      glyph: GLYPHS.asset,
      label: title,
      // O nome só aparece ao lado quando não é ele o título.
      detail: [title === asset.name ? null : asset.name, holdingLabel(asset)]
        .filter((part): part is string => part !== null)
        .join(' · '),
      amount: asset.holding?.market_value ?? null,
      shortcut: null,
      keywords: [asset.ticker, asset.name],
      target: { kind: 'asset', assetId: asset.id, slug: assetSlug(naming(asset)) },
      disabled: null,
    };
  });

/**
 * As ações sobre o ativo que está em primeiro. Só o primeiro: o resto são
 * variações do mesmo texto, e uma lista de nove ações para três ativos é a
 * paleta virando menu. Provento e transferência exigem posição — não se
 * recebe nem se move o que não se tem.
 */
export const assetActionItems = (
  asset: SearchAsset,
  readyActions: ReadonlySet<SearchActionId>,
): { readonly title: string; readonly items: readonly SearchItem[] } => {
  const held = asset.holding !== null;
  const title = assetName(asset);
  const make = (
    action: SearchActionId,
    label: string,
    shortcut: string | null,
  ): SearchItem => ({
    id: `action:${action}:${asset.id}`,
    group: 'asset_actions',
    glyph: GLYPHS.action,
    label,
    detail: null,
    amount: null,
    shortcut,
    keywords: [],
    target: { kind: 'action', action, assetId: asset.id, title },
    disabled: readyActions.has(action) ? null : ACTION_PENDING_REASON,
  });

  return {
    title: `Ações com ${title}`,
    items: [
      make('buy_asset', `Lançar compra de ${title}`, 'L'),
      ...(held
        ? [
            make('payout_asset', `Lançar provento de ${title}`, null),
            make('move_asset', `Mover ${title} para outra carteira`, null),
          ]
        : []),
    ],
  };
};

export const transactionLabel = (row: SearchTransaction): string => {
  const kind =
    row.kind === 'payout' && row.payout_kind !== null
      ? (PAYOUT_KIND_LABELS[row.payout_kind] ?? TRANSACTION_KIND_LABELS.payout)
      : TRANSACTION_KIND_LABELS[row.kind];
  const quantity =
    row.kind === 'buy' || row.kind === 'sell'
      ? ` ${formatQuantity(row.quantity).body}`
      : '';

  const asset =
    row.ticker === null
      ? ''
      : ` ${assetTitle({
          asset_id: row.asset_id ?? '',
          ticker: row.ticker,
          name: row.asset_name ?? row.ticker,
          b3_type: row.b3_type,
        })}`;

  return `${kind}${quantity}${asset}`;
};

export const transactionItems = (
  rows: readonly SearchTransaction[],
): readonly SearchItem[] =>
  rows.map((row): SearchItem => ({
    id: `transaction:${row.id}`,
    group: 'transactions',
    glyph: GLYPHS.transaction,
    label: transactionLabel(row),
    detail: [
      row.pending ? 'a receber' : null,
      formatDate(row.trade_date),
      row.portfolio_name,
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
    amount: row.net_amount,
    shortcut: null,
    keywords: [],
    target: { kind: 'transaction', transactionId: row.id, search: row.ticker },
    disabled: null,
  }));

/* -------------------------------------------------------------------------- */
/* Recentes                                                                   */

export type RecentEntry = Pick<
  SearchItem,
  'id' | 'glyph' | 'label' | 'detail' | 'amount' | 'shortcut' | 'target'
>;

const isRecentEntry = (value: unknown): value is RecentEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  const target = entry['target'];

  return (
    typeof entry['id'] === 'string' &&
    typeof entry['label'] === 'string' &&
    typeof entry['glyph'] === 'string' &&
    typeof target === 'object' &&
    target !== null &&
    typeof (target as Record<string, unknown>)['kind'] === 'string'
  );
};

const isRecentList = (value: unknown): value is readonly RecentEntry[] =>
  Array.isArray(value) && value.every(isRecentEntry);

export const readRecents = (storage: Storageish | null): readonly RecentEntry[] =>
  readJson(storage, RECENT_STORAGE_KEY, isRecentList, []).slice(0, RECENT_LIMIT);

/**
 * Ação não vira recente: "Novo lançamento" está a um `N` de distância, e uma
 * lista de recentes cheia de ações empurra para fora justamente o que a
 * pessoa quer reabrir — o ativo e a tela.
 */
export const isRememberable = (item: SearchItem): boolean =>
  item.target.kind !== 'action' && item.disabled === null;

export const rememberRecent = (
  storage: Storageish | null,
  item: SearchItem,
): readonly RecentEntry[] => {
  if (!isRememberable(item)) return readRecents(storage);

  const entry: RecentEntry = {
    id: item.id.startsWith('recent:') ? item.id.slice('recent:'.length) : item.id,
    glyph: item.glyph,
    label: item.label,
    detail: item.detail,
    amount: item.amount,
    shortcut: item.shortcut,
    target: item.target,
  };

  const next = [
    entry,
    ...readRecents(storage).filter((other) => other.id !== entry.id),
  ].slice(0, RECENT_LIMIT);
  writeJson(storage, RECENT_STORAGE_KEY, next);
  return next;
};

export const recentItems = (recents: readonly RecentEntry[]): readonly SearchItem[] =>
  recents.map((entry): SearchItem => ({
    ...entry,
    id: `recent:${entry.id}`,
    group: 'recent',
    keywords: [],
    disabled: null,
  }));

/* -------------------------------------------------------------------------- */
/* Montagem das seções                                                        */

/** Os filtros do Tab: tudo, e depois cada tipo. */
export type SearchFilter = 'assets' | 'transactions' | 'screens' | 'actions' | null;

export const SEARCH_FILTERS: readonly SearchFilter[] = [
  null,
  'assets',
  'transactions',
  'screens',
  'actions',
];

export const FILTER_LABELS: Readonly<Record<Exclude<SearchFilter, null>, string>> = {
  assets: 'Ativos',
  transactions: 'Lançamentos',
  screens: 'Telas',
  actions: 'Ações',
};

export const nextFilter = (current: SearchFilter, backwards = false): SearchFilter => {
  const index = SEARCH_FILTERS.indexOf(current);
  const step = backwards ? SEARCH_FILTERS.length - 1 : 1;
  return SEARCH_FILTERS[(index + step) % SEARCH_FILTERS.length] ?? null;
};

/** O filtro deixa de fora tudo que não é do tipo escolhido. */
const passesFilter = (group: SearchGroupId, filter: SearchFilter): boolean => {
  if (filter === null) return true;
  if (filter === 'assets') return group === 'assets' || group === 'asset_actions';
  return group === filter;
};

export type SearchServerState =
  /** Ainda não saiu pedido: texto vazio. */
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly resource: SearchResource };

export type SearchModel = {
  readonly sections: readonly SearchSection[];
  /** Quantos itens a paleta mostra. */
  readonly shown: number;
  /** Quantos existem — maior que `shown` quando a `api` cortou um grupo. */
  readonly total: number;
};

/**
 * Sem texto, a paleta é um atalho: o que se abriu por último, as telas e as
 * ações, nessa ordem. Com texto, ela é uma busca, e a ordem dos grupos segue a
 * pergunta "o que a pessoa provavelmente quer?" — o grupo cujo melhor item casa
 * melhor vem primeiro, e o item marcado é o primeiro de cima.
 */
export const buildModel = (input: {
  readonly query: string;
  readonly filter: SearchFilter;
  readonly local: readonly SearchItem[];
  readonly recents: readonly SearchItem[];
  readonly server: SearchServerState;
  readonly readyActions: ReadonlySet<SearchActionId>;
}): SearchModel => {
  const query = input.query.trim();

  const bucket = new Map<SearchGroupId, SearchItem[]>();
  const push = (group: SearchGroupId, items: readonly SearchItem[]): void => {
    if (items.length === 0 || !passesFilter(group, input.filter)) return;
    bucket.set(group, [...(bucket.get(group) ?? []), ...items]);
  };

  const titles = new Map<SearchGroupId, string>();
  const scores = new Map<SearchGroupId, number>();
  let omitted = 0;

  if (query === '') {
    push('recent', input.recents);
    push(
      'screens',
      input.local.filter((item) => item.group === 'screens'),
    );
    push(
      'actions',
      input.local.filter((item) => item.group === 'actions'),
    );
  } else {
    for (const group of ['screens', 'actions'] as const) {
      const scored = input.local
        .filter((item) => item.group === group)
        .map((item) => ({ item, score: scoreItem(item, query) }))
        .filter(({ score }) => score > 0)
        // `sort` é estável: empatados, vale a ordem em que a barra lateral os lista.
        .sort((a, b) => b.score - a.score);

      push(
        group,
        scored.map(({ item }) => item),
      );
      if (scored[0] !== undefined) scores.set(group, scored[0].score);
    }

    if (input.server.kind === 'ready') {
      const { assets, transactions } = input.server.resource;

      // A ordem que a `api` deu é a ordem: ela sabe o que a pessoa tem.
      const assetRows = assetItems(assets.items);
      push('assets', assetRows);
      if (assets.items[0] !== undefined) {
        const first = assets.items[0];
        scores.set(
          'assets',
          Math.max(scoreText(first.ticker, query), scoreText(first.name, query), 20),
        );

        const actions = assetActionItems(first, input.readyActions);
        titles.set('asset_actions', actions.title);
        push('asset_actions', actions.items);
      }
      omitted += Math.max(0, assets.total - assets.items.length);

      push('transactions', transactionItems(transactions.items));
      if (transactions.items[0] !== undefined) {
        const first = transactions.items[0];
        scores.set('transactions', Math.max(scoreText(first.ticker ?? '', query), 25));
      }
      omitted += Math.max(0, transactions.total - transactions.items.length);
    }
  }

  const ordered = CANONICAL_ORDER.filter((group) => bucket.has(group)).sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0),
  );

  // O que se faz com o ativo fica logo abaixo do ativo, qualquer que seja a
  // pontuação das telas: a ação lê como continuação da linha de cima.
  const withActions: SearchGroupId[] = ordered.filter(
    (group) => group !== 'asset_actions',
  );
  if (ordered.includes('asset_actions')) {
    const at = withActions.indexOf('assets');
    withActions.splice(at === -1 ? withActions.length : at + 1, 0, 'asset_actions');
  }

  const sections = withActions.map((group): SearchSection => ({
    group,
    title: titles.get(group) ?? GROUP_TITLES[group],
    items: bucket.get(group) ?? [],
  }));

  const shown = sections.reduce((sum, section) => sum + section.items.length, 0);
  return { sections, shown, total: shown + omitted };
};

/* -------------------------------------------------------------------------- */
/* Destinos                                                                   */

export type TargetContext = {
  /** O escopo da URL de agora: o apelido da carteira, ou `todas`. */
  readonly scope: string;
  /** O caminho da tela de agora, para trocar de carteira sem trocar de tela. */
  readonly currentScreenPath: string;
  /** O caminho de cada tela, pelo identificador. */
  readonly screenPaths: Readonly<Record<string, string>>;
  /** O apelido de uma carteira na URL, pelo identificador dela. */
  readonly scopeFor: (portfolioId: string) => string;
};

/**
 * O endereço de cada destino da paleta, ou `null` quando o destino não leva a
 * lugar nenhum — uma ação cuja tela ainda não existe.
 *
 * Trocar de carteira mantém a tela, como na barra lateral: quem troca está
 * comparando, não recomeçando. Abrir um lançamento leva ao extrato inteiro
 * filtrado pelo ativo dele, e não aos últimos três meses, pelo mesmo caminho do
 * "Ver lançamentos" da página do ativo.
 */
export const targetPath = (
  target: SearchTarget,
  context: TargetContext,
): string | null => {
  switch (target.kind) {
    case 'screen': {
      const path = context.screenPaths[target.screen];
      return path === undefined ? null : `/${context.scope}/${path}`;
    }
    case 'portfolio':
      return `/${context.scopeFor(target.portfolioId)}/${context.currentScreenPath}`;
    case 'asset':
      return `/${context.scope}/ativo/${target.slug}`;
    case 'transaction':
      return target.search === null || target.search === ''
        ? `/${context.scope}/movimentacoes`
        : `/${context.scope}/movimentacoes?${new URLSearchParams({
            busca: target.search,
            periodo: 'inicio',
          }).toString()}`;
    case 'action':
      return null;
  }
};

/* -------------------------------------------------------------------------- */
/* Seleção por teclado                                                        */

export const flatten = (sections: readonly SearchSection[]): readonly SearchItem[] =>
  sections.flatMap((section) => section.items);

/**
 * O item marcado. Guardar o identificador, e não a posição, é o que impede o
 * marcador de pular quando a `api` responde: quem desceu duas linhas continua
 * nela, mesmo que apareçam ativos acima.
 */
export const resolveActive = (
  sections: readonly SearchSection[],
  activeId: string | null,
): SearchItem | null => {
  const items = flatten(sections);
  const kept = items.find((item) => item.id === activeId && item.disabled === null);
  return kept ?? items.find((item) => item.disabled === null) ?? null;
};

/**
 * Anda entre os itens que podem ser executados, dando a volta nas pontas. Os
 * desativados ficam na tela — dizem o que vem em T-10 — mas o marcador passa
 * por cima deles, porque Enter num item que não faz nada é um beco.
 */
export const moveActive = (
  sections: readonly SearchSection[],
  activeId: string | null,
  delta: 1 | -1,
): string | null => {
  const enabled = flatten(sections).filter((item) => item.disabled === null);
  if (enabled.length === 0) return null;

  const current = resolveActive(sections, activeId);
  const index = enabled.findIndex((item) => item.id === current?.id);
  const next = (index + delta + enabled.length) % enabled.length;

  return enabled[next]?.id ?? null;
};
