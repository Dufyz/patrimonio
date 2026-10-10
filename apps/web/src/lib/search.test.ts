import type {
  SearchAsset,
  SearchResource,
  SearchTransaction,
} from '@patrimonio/contracts';
import { describe, expect, it } from 'vitest';

import type { Storageish } from './preferences.js';
import {
  ACTION_PENDING_REASON,
  RECENT_LIMIT,
  assetActionItems,
  assetItems,
  buildModel,
  flatten,
  holdingLabel,
  localItems,
  moveActive,
  nextFilter,
  normalize,
  readRecents,
  recentItems,
  rememberRecent,
  resolveActive,
  scoreItem,
  scoreText,
  targetPath,
  transactionItems,
  transactionLabel,
} from './search.js';
import type { SearchActionId, SearchServerState } from './search.js';

const SCREENS = [
  { id: 'visao', label: 'Visão geral', glyph: '▦', shortcut: 'G V' },
  { id: 'posicoes', label: 'Posições', glyph: '≡', shortcut: 'G P' },
  { id: 'movimentacoes', label: 'Movimentações', glyph: '⇄', shortcut: 'G M' },
  { id: 'desempenho', label: 'Desempenho', glyph: '◹', shortcut: 'G D' },
];
const PORTFOLIOS = [
  { id: 'longo', label: 'Longo prazo' },
];

const none = new Set<SearchActionId>();
const all = new Set<SearchActionId>([
  'new_transaction',
  'buy_asset',
  'payout_asset',
]);

const local = (ready: ReadonlySet<SearchActionId> = none) =>
  localItems({ screens: SCREENS, portfolios: PORTFOLIOS, readyActions: ready });

const itub4: SearchAsset = {
  id: '0191e5a0-0000-7000-8000-000000000001',
  ticker: 'ITUB4',
  name: 'Itaú Unibanco PN',
  b3_type: 'stock',
  holding: {
    quantity: '500.00000000',
    market_value: '18420.00',
    portfolio_names: ['Longo prazo'],
  },
};
const itub3: SearchAsset = {
  id: '0191e5a0-0000-7000-8000-000000000002',
  ticker: 'ITUB3',
  name: 'Itaú Unibanco ON',
  b3_type: 'stock',
  holding: null,
};
const compra: SearchTransaction = {
  id: '0191e5a0-0000-7000-8000-000000000011',
  kind: 'buy',
  payout_kind: null,
  trade_date: '2025-03-12',
  portfolio_id: '0191e5a0-0000-7000-8000-0000000000a1',
  portfolio_name: 'Longo prazo',
  asset_id: itub4.id,
  ticker: 'ITUB4',
  asset_name: 'Itaú Unibanco PN',
  b3_type: 'stock',
  quantity: '100.00000000',
  net_amount: '-3000.00',
  pending: false,
};
const jcp: SearchTransaction = {
  ...compra,
  id: '0191e5a0-0000-7000-8000-000000000012',
  kind: 'payout',
  payout_kind: 'jcp',
  trade_date: '2026-10-20',
  quantity: '500.00000000',
  net_amount: '96.12',
  pending: true,
};

const ready = (
  assets: readonly SearchAsset[],
  transactions: readonly SearchTransaction[],
  totals?: { assets?: number; transactions?: number },
): SearchServerState => {
  const resource: SearchResource = {
    query: 'q',
    assets: { total: totals?.assets ?? assets.length, items: [...assets] },
    transactions: {
      total: totals?.transactions ?? transactions.length,
      items: [...transactions],
    },
  };
  return { kind: 'ready', resource };
};

const model = (
  query: string,
  server: SearchServerState = { kind: 'idle' },
  overrides: Partial<Parameters<typeof buildModel>[0]> = {},
) =>
  buildModel({
    query,
    filter: null,
    local: local(),
    recents: [],
    server,
    readyActions: none,
    ...overrides,
  });

const groups = (query: string, server?: SearchServerState) =>
  model(query, server).sections.map((section) => section.group);

const memory = (
  initial: Record<string, string> = {},
): Storageish & {
  readonly data: Map<string, string>;
} => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

describe('texto', () => {
  it('ignora acento e maiúscula', () => {
    expect(normalize('  Ações ')).toBe('acoes');
    expect(scoreText('Itaú Unibanco PN', 'ITAU')).toBeGreaterThan(0);
    expect(scoreText('Ações', 'acoes')).toBe(100);
  });

  it('pontua exato, começo, começo de palavra e trecho, nessa ordem', () => {
    const exact = scoreText('ITUB4', 'itub4');
    const prefix = scoreText('ITUB4', 'itu');
    const word = scoreText('Itaú Unibanco PN', 'unib');
    const contains = scoreText('Itaú Unibanco PN', 'nibanco');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(0);
  });

  it('devolve zero quando não casa, e para texto vazio', () => {
    expect(scoreText('Posições', 'zzz')).toBe(0);
    expect(scoreText('Posições', '  ')).toBe(0);
  });
});

describe('itens locais', () => {
  it('lista as telas com o atalho que elas têm', () => {
    const screens = local().filter((item) => item.group === 'screens');

    expect(screens.map((item) => [item.label, item.shortcut])).toEqual([
      ['Visão geral', 'G V'],
      ['Posições', 'G P'],
      ['Movimentações', 'G M'],
      ['Desempenho', 'G D'],
    ]);
  });

  it('mostra "Novo lançamento" desativado até a tela existir, e ativo depois', () => {
    const pending = local().find((item) => item.id === 'action:new_transaction');
    const done = local(all).find((item) => item.id === 'action:new_transaction');

    expect(pending?.disabled).toBe(ACTION_PENDING_REASON);
    expect(done?.disabled).toBeNull();
  });

  it('não promete atalho que não existe para "Ir para a carteira"', () => {
    const portfolio = local().find((item) => item.id === 'portfolio:longo');

    expect(portfolio?.label).toBe('Ir para Longo prazo');
    expect(portfolio?.shortcut).toBeNull();
  });
});

describe('sem texto', () => {
  it('abre com telas e ações, sem precisar de nenhum pedido', () => {
    const view = model('');

    expect(view.sections.map((section) => section.group)).toEqual(['screens', 'actions']);
    expect(view.sections[0]?.items).toHaveLength(4);
    expect(view.total).toBe(view.shown);
  });

  it('põe os recentes primeiro', () => {
    const recents = recentItems([
      {
        id: 'screen:posicoes',
        glyph: '≡',
        label: 'Posições',
        detail: 'Longo prazo',
        amount: null,
        shortcut: 'G P',
        target: { kind: 'screen', screen: 'posicoes' },
      },
    ]);

    const view = model('', { kind: 'idle' }, { recents });

    expect(view.sections.map((section) => section.group)).toEqual([
      'recent',
      'screens',
      'actions',
    ]);
    expect(view.sections[0]?.items[0]?.id).toBe('recent:screen:posicoes');
  });
});

describe('com texto', () => {
  it('acha tela pelo nome sem acento e por sinônimo', () => {
    const porNome = model('posicoes').sections[0]?.items.map((item) => item.label);
    const porSinonimo = model('rentabilidade').sections[0]?.items.map(
      (item) => item.label,
    );

    expect(porNome).toEqual(['Posições']);
    expect(porSinonimo).toEqual(['Desempenho']);
  });

  it('acha Configurações por sinônimo, e ela não tem atalho de teclado', () => {
    const view = buildModel({
      query: 'backup',
      filter: null,
      local: localItems({
        screens: [
          ...SCREENS,
          { id: 'configuracoes', label: 'Configurações', glyph: '☼', shortcut: null },
        ],
        portfolios: PORTFOLIOS,
        readyActions: none,
      }),
      recents: [],
      server: { kind: 'idle' },
      readyActions: none,
    });

    expect(view.sections[0]?.items.map((item) => [item.label, item.shortcut])).toEqual([
      ['Configurações', null],
    ]);
  });

  it('acha a carteira pela ação "Ir para"', () => {
    const view = model('longo');

    expect(view.sections[0]?.group).toBe('actions');
    expect(view.sections[0]?.items[0]?.label).toBe('Ir para Longo prazo');
  });

  it('põe o ativo em primeiro, e as ações dele logo abaixo, como a prancha 12', () => {
    const order = groups('itu', ready([itub4, itub3], [compra, jcp]));

    expect(order).toEqual(['assets', 'asset_actions', 'transactions']);
  });

  it('mantém a ordem que a api deu aos ativos', () => {
    const view = model('itu', ready([itub4, itub3], []));
    const assets = view.sections.find((section) => section.group === 'assets');

    expect(assets?.items.map((item) => item.label)).toEqual(['ITUB4', 'ITUB3']);
  });

  it('põe a tela antes do ativo quando a tela casa melhor', () => {
    const fundo: SearchAsset = {
      ...itub3,
      ticker: 'XPOS11',
      name: 'Fundo Posições Gerais',
    };

    const order = groups('posicoes', ready([fundo], []));

    // "Posições" é exato (100); o fundo só tem a palavra no nome (60).
    expect(order).toEqual(['screens', 'assets', 'asset_actions']);
  });

  it('só oferece provento de quem tem posição', () => {
    const held = assetActionItems(itub4, all).items.map((item) => item.label);
    const notHeld = assetActionItems(itub3, all).items.map((item) => item.label);

    expect(held).toEqual([
      'Lançar compra de ITUB4',
      'Lançar provento de ITUB4',
    ]);
    expect(notHeld).toEqual(['Lançar compra de ITUB3']);
  });

  it('titula as ações com o código do ativo', () => {
    const view = model('itu', ready([itub4], []));

    expect(view.sections.find((s) => s.group === 'asset_actions')?.title).toBe(
      'Ações com ITUB4',
    );
  });

  it('enquanto a api não responde, mostra só o que o navegador já sabe', () => {
    expect(groups('itu', { kind: 'loading' })).toEqual([]);
    expect(groups('pos', { kind: 'loading' })).toEqual(['screens']);
    expect(groups('pos', { kind: 'error' })).toEqual(['screens']);
  });

  it('conta o que a api cortou, para "mostrando 5 de 24" ser verdade', () => {
    const view = model(
      'itu',
      ready([itub4, itub3], [compra], { assets: 19, transactions: 1 }),
    );

    expect(view.total - view.shown).toBe(17);
  });

  it('não confunde grupo vazio com grupo ausente', () => {
    expect(groups('zzzz', ready([], []))).toEqual([]);
  });
});

describe('filtro por tipo (Tab)', () => {
  it('deixa só o tipo escolhido', () => {
    const server = ready([itub4], [compra]);

    expect(
      model('itu', server, { filter: 'transactions' }).sections.map((s) => s.group),
    ).toEqual(['transactions']);
    expect(
      model('itu', server, { filter: 'assets' }).sections.map((s) => s.group),
    ).toEqual(['assets', 'asset_actions']);
  });

  it('percorre os tipos e dá a volta, nos dois sentidos', () => {
    expect(nextFilter(null)).toBe('assets');
    expect(nextFilter('assets')).toBe('transactions');
    expect(nextFilter('actions')).toBeNull();
    expect(nextFilter(null, true)).toBe('actions');
    expect(nextFilter('assets', true)).toBeNull();
  });
});

describe('seleção por teclado', () => {
  const sections = model('itu', ready([itub4, itub3], [compra])).sections;

  it('marca o primeiro item que pode ser executado', () => {
    expect(resolveActive(sections, null)?.label).toBe('ITUB4');
  });

  it('mantém o item marcado quando a lista muda embaixo dele', () => {
    const before = model('itu', { kind: 'loading' }, { local: local() }).sections;
    const after = model('itu', ready([itub4], [compra])).sections;
    const marked = resolveActive(after, 'transaction:' + compra.id);

    expect(before).toEqual([]);
    expect(marked?.id).toBe('transaction:' + compra.id);
  });

  it('desce, sobe e dá a volta', () => {
    const items = flatten(sections).filter((item) => item.disabled === null);
    const first = items[0]?.id ?? null;
    const last = items.at(-1)?.id ?? null;

    expect(moveActive(sections, last, 1)).toBe(first);
    expect(moveActive(sections, first, -1)).toBe(last);
    expect(moveActive(sections, first, 1)).toBe(items[1]?.id);
  });

  it('passa por cima do que está desativado', () => {
    const view = model('itu', ready([itub4], []), { readyActions: none }).sections;
    const enabled = flatten(view).filter((item) => item.disabled === null);

    expect(flatten(view).some((item) => item.disabled !== null)).toBe(true);
    expect(enabled.map((item) => item.label)).toEqual(['ITUB4']);
    expect(moveActive(view, enabled[0]?.id ?? null, 1)).toBe(enabled[0]?.id);
  });

  it('devolve nulo quando não há o que marcar', () => {
    expect(resolveActive([], null)).toBeNull();
    expect(moveActive([], null, 1)).toBeNull();
  });
});

describe('rótulos', () => {
  it('descreve a posição', () => {
    expect(holdingLabel(itub4)).toBe('500 em Longo prazo');
    expect(holdingLabel(itub3)).toBe('sem posição');
    expect(
      holdingLabel({
        ...itub4,
        holding: { quantity: '600', market_value: '1', portfolio_names: ['A', 'B', 'C'] },
      }),
    ).toBe('600 em 3 carteiras');
  });

  it('diz o tipo, a quantidade e o ativo do lançamento', () => {
    expect(transactionLabel(compra)).toBe('Compra 100 ITUB4');
    expect(transactionLabel(jcp)).toBe('JCP ITUB4');
    expect(
      transactionLabel({
        ...compra,
        kind: 'deposit',
        asset_id: null,
        ticker: null,
        asset_name: null,
        b3_type: null,
        quantity: '0',
      }),
    ).toBe('Aporte');
  });

  it('marca o provento a receber e traz a data e a carteira', () => {
    const [row] = transactionItems([jcp]);

    expect(row?.detail).toBe('a receber · 20/10/2026 · Longo prazo');
    expect(row?.amount).toBe('96.12');
  });
});

const cdb: SearchAsset = {
  id: '0191e5a0-0000-7000-8000-000000000003',
  ticker: 'CDB-BANCOC-20280614',
  name: 'CDB Banco C 2028',
  b3_type: null,
  holding: {
    quantity: '1',
    market_value: '10250.00',
    portfolio_names: ['Reserva'],
  },
};

describe('renda fixa', () => {
  it('chama o título pelo nome, e não pela chave do banco', () => {
    const [item] = assetItems([cdb]);

    expect(item?.label).toBe('CDB Banco C 2028');
    expect(item?.detail).toBe('1 em Reserva');
    // A chave continua achando o título, para quem a colou de outro lugar.
    expect(item === undefined ? 0 : scoreItem(item, 'CDB-BANCOC')).toBeGreaterThan(0);
  });

  it('abre o título pelo identificador, como o resto da aplicação', () => {
    const [item] = assetItems([cdb]);

    expect(item?.target).toEqual({ kind: 'asset', assetId: cdb.id, slug: cdb.id });
  });

  it('abre a ação com o nome do título', () => {
    expect(assetActionItems(cdb, all).title).toBe('Ações com CDB Banco C 2028');
  });

  it('abre o ativo listado pelo código em minúscula', () => {
    const [item] = assetItems([itub4]);

    expect(item?.target).toEqual({ kind: 'asset', assetId: itub4.id, slug: 'itub4' });
    expect(item?.detail).toBe('Itaú Unibanco PN · 500 em Longo prazo');
  });

  it('escreve o lançamento de renda fixa com o nome do título', () => {
    expect(
      transactionLabel({
        ...compra,
        ticker: cdb.ticker,
        asset_name: cdb.name,
        b3_type: null,
        quantity: '1.00000000',
      }),
    ).toBe('Compra 1 CDB Banco C 2028');
  });
});

describe('recentes', () => {
  const item = (id: string, group: 'screens' | 'assets' = 'screens') => ({
    ...local()[0]!,
    id,
    group,
    label: id,
  });

  it('guarda o mais recente primeiro, sem repetir', () => {
    const storage = memory();

    rememberRecent(storage, item('screen:a'));
    rememberRecent(storage, item('screen:b'));
    const next = rememberRecent(storage, item('screen:a'));

    expect(next.map((entry) => entry.id)).toEqual(['screen:a', 'screen:b']);
  });

  it('guarda no máximo cinco', () => {
    const storage = memory();

    for (let index = 0; index < 8; index += 1) {
      rememberRecent(storage, item(`screen:${index}`));
    }

    const stored = readRecents(storage);
    expect(stored).toHaveLength(RECENT_LIMIT);
    expect(stored[0]?.id).toBe('screen:7');
  });

  it('não guarda ação nem item desativado', () => {
    const storage = memory();
    const [action] = local().filter((entry) => entry.id === 'action:new_transaction');

    rememberRecent(storage, action!);

    expect(readRecents(storage)).toEqual([]);
  });

  it('abrir um recente não o duplica com o prefixo', () => {
    const storage = memory();
    const [first] = rememberRecent(storage, item('screen:a'));
    const [opened] = recentItems([first!]);

    const next = rememberRecent(storage, opened!);

    expect(next.map((entry) => entry.id)).toEqual(['screen:a']);
  });

  it('ignora lixo no armazenamento, e funciona sem armazenamento', () => {
    expect(readRecents(memory({ 'patrimonio.search.recent': '{não é json' }))).toEqual(
      [],
    );
    expect(readRecents(memory({ 'patrimonio.search.recent': '[1,2]' }))).toEqual([]);
    expect(readRecents(null)).toEqual([]);
    // Sem armazenamento o item não persiste, mas a lista devolvida o inclui:
    // é ela que a paleta mostra até a aba fechar.
    expect(rememberRecent(null, item('screen:a')).map((entry) => entry.id)).toEqual([
      'screen:a',
    ]);
  });
});

describe('destinos', () => {
  const context = {
    scope: 'longo-prazo',
    currentScreenPath: 'posicoes',
    screenPaths: { visao: 'visao-geral', posicoes: 'posicoes' },
    scopeFor: (_portfolioId: string) => 'reserva',
  };

  it('vai para a tela dentro do escopo de agora', () => {
    expect(targetPath({ kind: 'screen', screen: 'visao' }, context)).toBe(
      '/longo-prazo/visao-geral',
    );
  });

  it('não leva a lugar nenhum uma tela que não existe', () => {
    expect(targetPath({ kind: 'screen', screen: 'inexistente' }, context)).toBeNull();
  });

  it('troca de carteira mantendo a tela', () => {
    expect(targetPath({ kind: 'portfolio', portfolioId: 'x' }, context)).toBe(
      '/reserva/posicoes',
    );
  });

  it('abre o ativo pelo apelido dele', () => {
    expect(targetPath({ kind: 'asset', assetId: 'a', slug: 'itub4' }, context)).toBe(
      '/longo-prazo/ativo/itub4',
    );
  });

  it('abre o lançamento no extrato inteiro filtrado pelo ativo', () => {
    expect(
      targetPath({ kind: 'transaction', transactionId: 't', search: 'ITUB4' }, context),
    ).toBe('/longo-prazo/movimentacoes?busca=ITUB4&periodo=inicio');
  });

  it('codifica o que a pessoa não escreveu em URL', () => {
    expect(
      targetPath({ kind: 'transaction', transactionId: 't', search: 'A&B C' }, context),
    ).toBe('/longo-prazo/movimentacoes?busca=A%26B+C&periodo=inicio');
  });

  it('abre o extrato sem filtro quando o lançamento não tem ativo', () => {
    expect(
      targetPath({ kind: 'transaction', transactionId: 't', search: null }, context),
    ).toBe('/longo-prazo/movimentacoes');
  });

  it('não leva a lugar nenhum uma ação cuja tela ainda não existe', () => {
    expect(targetPath({ kind: 'action', action: 'new_transaction' }, context)).toBeNull();
  });
});
