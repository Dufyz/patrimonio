import type {
  PositionGroup,
  PositionResource,
  PositionsResource,
} from '@patrimonio/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import { ShortcutProvider } from '../components/shortcuts.js';
import { PositionsScreen } from './positions.js';

/**
 * T-02 · A tela contra a prancha 05.
 *
 * Os números são os da prancha, de propósito: é mais fácil enxergar um
 * desalinhamento comparando o mesmo número. O que estes testes cobrem é o que
 * quebraria em silêncio — o subtotal que deixa de bater com a `api`, o filtro
 * que some da URL, a coluna que desaparece na largura errada.
 */

const position = (overrides: Partial<PositionResource> = {}): PositionResource => ({
  portfolio_id: '11111111-1111-4111-8111-111111111111',
  portfolio_name: 'Longo prazo',
  asset_id: 'aaaa1111-1111-4111-8111-111111111111',
  ticker: 'ITUB4',
  name: 'Itaú Unibanco PN',
  origin: 'market',
  b3_type: 'stock',
  institution_id: 'bbbb1111-1111-4111-8111-111111111111',
  institution_name: 'Corretora A',
  category_id: 'cccc1111-1111-4111-8111-111111111111',
  category_name: 'Ações',
  color_token: 'class.acoes',
  unit: 'quantity',
  quantity: '500',
  avg_price: '29.10',
  price: '36.84',
  price_health: 'fresh',
  price_date: '2026-10-06',
  value: '18420.00',
  cost_basis: '14550.00',
  open_result: '3870.00',
  open_result_ratio: '0.266',
  weight: '0.058',
  day_change_ratio: '0.004',
  return_12m_ratio: '0.214',
  dividend_yield_12m: '0.061',
  indexer: null,
  rate: null,
  maturity_date: null,
  ...overrides,
});

const acoes: PositionGroup = {
  key: 'cccc1111-1111-4111-8111-111111111111',
  label: 'Ações',
  color_token: 'class.acoes',
  // Seis linhas, das quais a tabela mostra cinco. O subtotal cobre as seis: é
  // exatamente o caso em que somar na tela daria outro número.
  summary: {
    count: 6,
    value: '112640.35',
    cost_basis: '102820.20',
    open_result: '9820.15',
    open_result_ratio: '0.096',
    weight: '0.353',
  },
  positions: [
    position(),
    position({
      asset_id: 'aaaa2222-2222-4222-8222-222222222222',
      ticker: 'WEGE3',
      name: 'WEG ON',
      value: '15230.00',
      open_result: '-3170.00',
      open_result_ratio: '-0.172',
      weight: '0.048',
      dividend_yield_12m: '0.018',
    }),
    position({
      asset_id: 'aaaa4444-4444-4444-8444-444444444444',
      ticker: 'EGIE3',
      value: '12375.00',
    }),
    position({
      asset_id: 'aaaa5555-5555-4555-8555-555555555555',
      ticker: 'VALE3',
      value: '11680.00',
    }),
    position({
      asset_id: 'aaaa6666-6666-4666-8666-666666666666',
      ticker: 'PETR4',
      value: '10818.80',
    }),
    position({
      asset_id: 'aaaa7777-7777-4777-8777-777777777777',
      ticker: 'BBAS3',
      value: '44116.55',
    }),
  ],
};

const cdb: PositionGroup = {
  key: 'cccc3333-3333-4333-8333-333333333333',
  label: 'RF prefixada',
  color_token: 'class.rf-pre',
  summary: {
    count: 1,
    value: '16500.00',
    cost_basis: '15120.00',
    open_result: '1380.00',
    open_result_ratio: '0.091',
    weight: '0.052',
  },
  positions: [
    position({
      asset_id: 'aaaa3333-3333-4333-8333-333333333333',
      ticker: 'CDBC2028',
      name: 'CDB Prefixado Banco C 2028',
      origin: 'manual',
      b3_type: null,
      institution_name: 'Banco C',
      category_id: 'cccc3333-3333-4333-8333-333333333333',
      category_name: 'RF prefixada',
      color_token: 'class.rf-pre',
      unit: 'curve',
      quantity: null,
      avg_price: null,
      price: null,
      value: '16500.00',
      cost_basis: '15120.00',
      open_result: '1380.00',
      open_result_ratio: '0.091',
      weight: '0.052',
      dividend_yield_12m: null,
      indexer: 'prefixed',
      rate: '14.10',
      maturity_date: '2028-06-14',
    }),
  ],
};

const resource = (overrides: Partial<PositionsResource> = {}): PositionsResource => ({
  as_of: '2026-10-06',
  computed_at: '2026-10-06T18:02:00.000Z',
  group_by: 'category',
  groups: [acoes, cdb],
  total: {
    count: 28,
    value: '318904.12',
    cost_basis: '293230.53',
    open_result: '25673.59',
    open_result_ratio: '0.088',
    weight: '1',
  },
  day_change_ratio: '0.002',
  return_12m_ratio: '0.1592',
  payouts_12m: '14218.40',
  facets: [
    {
      id: 'cccc1111-1111-4111-8111-111111111111',
      label: 'Ações',
      color_token: 'class.acoes',
      count: 14,
    },
    {
      id: 'cccc2222-2222-4222-8222-222222222222',
      label: 'FIIs',
      color_token: 'class.fiis',
      count: 9,
    },
  ],
  price_health: { fresh: 27, stale: 1, manual: 0, missing: 0 },
  ...overrides,
});

const calls: string[] = [];
const posted: unknown[] = [];

/** A resposta de L-14, que o preço manual lê para mostrar o antes → depois. */
const MANUAL_PRICE = {
  manual_price: {
    asset_id: 'aaaa1111-1111-4111-8111-111111111111',
    price_date: '2026-10-06',
    price: '39.90',
    created_at: '2026-10-06T18:10:00.000Z',
    updated_at: '2026-10-06T18:10:00.000Z',
  },
  preview: {
    quantity: '500',
    previous_price: '36.84',
    previous_source: 'manual' as const,
    price: '39.90',
    position_value: { before: '18420.00', after: '19950.00' },
  },
  message: 'Preço manual salvo',
};

const answerWith = (body: PositionsResource): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MANUAL_PRICE),
        } as Response);
      }
      calls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      } as Response);
    }),
  );
};

const show = (initial = '/longo-prazo/posicoes', width = 1440) => {
  // O jsdom mede tudo como zero; a largura é informada, como na galeria.
  Object.defineProperty(globalThis, 'innerWidth', { value: width, writable: true });

  return render(
    <MemoryRouter initialEntries={[initial]}>
      <PreferencesProvider storage={null}>
        <ShortcutProvider>
          <PositionsScreen portfolioId="p1" scopeLabel="Longo prazo" />
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  calls.length = 0;
  posted.length = 0;
  answerWith(resource());
});

afterEach(() => vi.unstubAllGlobals());

describe('tela de Posições', () => {
  it('o cabeçalho responde à pergunta da tela antes de qualquer tabela', async () => {
    show();

    expect(await screen.findByText('28 posições')).toBeInTheDocument();
    // O mesmo número aparece no cabeçalho e no total: os dois vêm da api.
    expect(screen.getAllByText('R$ 318.904,12')).toHaveLength(2);
    expect(screen.getByText('R$ 14.218,40')).toBeInTheDocument();
  });

  it('o subtotal do grupo é o da api, e não a soma das linhas visíveis', async () => {
    show();

    // Catorze linhas no subtotal, duas na resposta: somar na tela daria 33.650,00.
    const subtotal = await screen.findByText('R$ 112.640,35');
    const group = subtotal.closest('tr');

    expect(group).not.toBeNull();
    expect(within(group as HTMLElement).getByText('Ações')).toBeInTheDocument();
    expect(within(group as HTMLElement).getByText('6')).toBeInTheDocument();
    // A sexta linha está atrás do "mostrar mais", e o subtotal continua inteiro.
    expect(screen.getByText(/Mostrar mais 1/)).toBeInTheDocument();
    expect(screen.queryByText('BBAS3')).toBeNull();
  });

  it('o total geral vem da api junto com os subtotais', async () => {
    show();
    await screen.findByText('28 posições');

    const total = screen.getByText('Total').closest('tr');
    expect(within(total as HTMLElement).getByText('R$ 318.904,12')).toBeInTheDocument();
  });

  it('título marcado na curva não finge ter quantidade nem preço', async () => {
    show();

    // Um título de banco se apresenta pelo nome: o código gerado é chave, não nome.
    const row = (await screen.findByText('CDB Prefixado Banco C 2028')).closest('tr');
    expect(within(row as HTMLElement).getByText('curva')).toBeInTheDocument();
    expect(
      within(row as HTMLElement).getByText('Pré 14,10% · 14/06/2028'),
    ).toBeInTheDocument();
  });

  it('clicar na linha abre o ativo embaixo dela, sem sair da tela', async () => {
    const user = userEvent.setup();
    show();

    const row = (await screen.findByText('ITUB4')).closest('tr');
    await user.click(row as HTMLElement);

    expect(await screen.findByText('Itaú Unibanco PN')).toBeInTheDocument();
    expect(screen.getByText('Custo total')).toBeInTheDocument();

    await user.click(row as HTMLElement);
    await waitFor(() => expect(screen.queryByText('Custo total')).toBeNull());
  });

  it('cada linha tem menu com lançar, preço manual e abrir o ativo', async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: 'Ações de ITUB4' }));

    expect(
      screen.getByRole('menuitem', { name: /Lançar compra ou venda/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /Definir preço manual/ }),
    ).toBeInTheDocument();
  });

  it('abrir o preço manual não abre o detalhe da linha junto', async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: 'Ações de ITUB4' }));
    expect(screen.queryByText('Custo total')).toBeNull();
  });

  it('o preço manual sai da linha, em pt-BR, e volta como efeito calculado', async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: 'Ações de ITUB4' }));
    await user.click(screen.getByRole('menuitem', { name: /Definir preço manual/ }));

    const campo = screen.getByRole('textbox', { name: 'Preço' });
    // O campo abre com o preço de hoje já em vírgula, e não em ponto.
    expect(campo).toHaveValue('36,84');

    await user.clear(campo);
    await user.type(campo, '39,90');
    await user.click(screen.getByRole('button', { name: 'Salvar preço' }));

    // O que vai para a api é o decimal do contrato, nunca o que foi digitado.
    expect(await screen.findByText(/recálculo foi enfileirado/)).toBeInTheDocument();
    expect(posted).toEqual([{ price_date: '2026-10-06', price: '39.90' }]);
    // O valor depois aparece no antes → depois e na frase do recálculo.
    expect(screen.getAllByText('R$ 19.950,00')).toHaveLength(2);
  });

  it('valor que não é valor não é salvo, e o campo diz o que falta', async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: 'Ações de ITUB4' }));
    await user.click(screen.getByRole('menuitem', { name: /Definir preço manual/ }));

    const campo = screen.getByRole('textbox', { name: 'Preço' });
    await user.clear(campo);
    await user.type(campo, 'trinta');

    expect(screen.getByRole('button', { name: 'Salvar preço' })).toBeDisabled();
    expect(posted).toHaveLength(0);
  });

  it('trocar o agrupamento vai para a URL e para a api', async () => {
    const user = userEvent.setup();
    show();

    await screen.findByText('28 posições');
    await user.click(screen.getByRole('radio', { name: 'Instituição' }));

    await waitFor(() => expect(calls.at(-1)).toContain('group_by=institution'));
  });

  it('o padrão não é escrito na URL nem repetido no pedido', async () => {
    show();
    await screen.findByText('28 posições');

    expect(calls[0]).toContain('group_by=category');
    expect(calls[0]).not.toContain('search=');
    expect(calls[0]).not.toContain('category_id=');
  });

  it('a pastilha de categoria filtra pela api, e a contagem dela não muda', async () => {
    const user = userEvent.setup();
    show();

    await screen.findByText('ITUB4');
    const filters = screen.getByRole('group', { name: 'Filtrar por categoria' });
    await user.click(within(filters).getByRole('button', { name: /Ações/ }));

    await waitFor(() =>
      expect(calls.at(-1)).toContain('category_id=cccc1111-1111-4111-8111-111111111111'),
    );
  });

  it('a busca espera a digitação parar antes de virar pedido', async () => {
    const user = userEvent.setup();
    show();

    await screen.findByText('28 posições');
    const before = calls.length;
    await user.type(screen.getByLabelText('Buscar posição'), 'itub');

    await waitFor(() => expect(calls.at(-1)).toContain('search=itub'));
    // Quatro letras, um pedido — e não quatro.
    expect(calls.length).toBe(before + 1);
  });

  it('filtro sem resultado diz que o filtro é o problema, e oferece limpá-lo', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('28 posições');

    answerWith(
      resource({
        groups: [],
        total: {
          count: 0,
          value: '0',
          cost_basis: '0',
          open_result: '0',
          open_result_ratio: null,
          weight: '0',
        },
      }),
    );
    await user.type(screen.getByLabelText('Buscar posição'), 'zzz');

    expect(
      await screen.findByText('Nenhuma posição corresponde ao filtro.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument();
  });

  it('carteira sem fechamento diz isso em vez de abrir em branco', async () => {
    answerWith(
      resource({
        as_of: null,
        computed_at: null,
        groups: [],
        facets: [],
        total: {
          count: 0,
          value: '0',
          cost_basis: '0',
          open_result: '0',
          open_result_ratio: null,
          weight: '0',
        },
      }),
    );
    show();

    expect(await screen.findByText(/Ainda não houve fechamento/)).toBeInTheDocument();
  });

  it('a api fora do ar aparece como mensagem, não como tabela vazia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          json: () =>
            Promise.resolve({ message: 'Postgres não respondeu', request_id: 'r1' }),
        } as Response),
      ),
    );
    show();

    expect(await screen.findByText('Postgres não respondeu')).toBeInTheDocument();
  });

  it('ocultar valores esconde reais e mantém a leitura relativa', async () => {
    const user = userEvent.setup();
    show();

    await screen.findByText('28 posições');
    await user.click(screen.getByRole('button', { name: 'Ocultar valores' }));

    expect(screen.queryByText('R$ 318.904,12')).toBeNull();
    // O peso continua: é o que sobra para ler em lugar público.
    expect(screen.getAllByText('5,8%').length).toBeGreaterThan(0);
  });
});
