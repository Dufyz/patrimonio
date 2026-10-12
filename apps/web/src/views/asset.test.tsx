import type { AssetPageResource } from '@patrimonio/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import { ShortcutProvider } from '../components/shortcuts.js';
import { AssetScreen } from './asset.js';

const entry = vi.hoisted(() => ({
  openEntry: vi.fn(),
  openEdit: vi.fn(),
  openConfirmPayout: vi.fn(),
  version: 0,
}));

vi.mock('../components/entry_provider.js', () => ({ useEntry: () => entry }));

/**
 * T-03 · A página do ativo contra a prancha 06.
 *
 * Os números são os da prancha, de propósito: 500 cotas de ITUB4 a 29,10 de
 * preço médio valendo 18.420,00, com 1.120,50 de provento em doze meses. O que
 * estes testes cobrem é o que quebraria em silêncio — o recorte que some da
 * URL, o bloco que aparece vazio em vez de sair, a ausência desenhada como
 * zero.
 */

const points = Array.from({ length: 13 }, (_, index) => {
  const month = String((index % 12) + 1).padStart(2, '0');
  const year = index < 3 ? 2025 : 2026;
  const close = (31 + index * 0.45).toFixed(2);
  return { price_date: `${year}-${month}-06`, close, adjusted_close: close };
});

const resource = (overrides: Partial<AssetPageResource> = {}): AssetPageResource => ({
  portfolio_id: '11111111-1111-4111-8111-111111111111',
  portfolio_name: 'Longo prazo',
  as_of: '2026-10-06',
  computed_at: '2026-10-06T21:02:00.000Z',
  asset: {
    asset_id: 'aaaa1111-1111-4111-8111-111111111111',
    ticker: 'ITUB4',
    name: 'Itaú Unibanco PN',
    origin: 'market',
    b3_type: 'stock',
    sector: 'Bancos',
    price_source: 'auto',
    category_id: 'cccc1111-1111-4111-8111-111111111111',
    category_name: 'Ações',
    color_token: 'class.acoes',
    category_automatic: true,
    issuer_id: null,
    issuer_name: null,
    archived_at: null,
    indexer: null,
    rate: null,
    issued_at: null,
    maturity_date: null,
    liquidity: null,
    liquidity_days: null,
    tax_regime: null,
  },
  price: {
    value: '36.84',
    day_change_ratio: '0.0082',
    price_health: 'fresh',
    price_date: '2026-10-06',
  },
  position: {
    unit: 'quantity',
    quantity: '500',
    avg_price: '29.10',
    cost_basis: '14550.00',
    value: '18420.00',
    open_result: '3870.00',
    open_result_ratio: '0.266',
    weight: '0.058',
    accrued_interest: '0',
    realized_result: null,
    payouts_12m: '1120.50',
    yield_on_cost_12m: '0.077',
  },
  lifetime: {
    invested: '14550.00',
    proceeds: '0',
    payouts_received: '2210.00',
    realized_result: null,
    first_trade_date: '2025-03-12',
    last_trade_date: '2026-06-10',
    buys: 3,
    sells: 0,
    twr_ratio: '0.231',
    xirr_ratio: '0.184',
  },
  series: {
    period: '1a',
    from: '2025-10-06',
    to: '2026-10-06',
    points,
    value_points: [],
    marks: [
      { trade_date: '2026-01-06', side: 'buy', quantity: '100', unit_price: '33.80' },
      { trade_date: '2026-06-06', side: 'buy', quantity: '50', unit_price: '35.10' },
    ],
    adjusted: false,
    return_ratio: '0.175',
    return_with_payouts_ratio: '0.214',
  },
  payouts: {
    months: [
      month('2025-11'),
      month('2025-12', { jcp: '500.00', total: '500.00' }),
      month('2026-01'),
      month('2026-02'),
      month('2026-03', { jcp: '510.50', total: '510.50' }),
      month('2026-04'),
      month('2026-05'),
      month('2026-06'),
      month('2026-07'),
      month('2026-08'),
      month('2026-09'),
      month('2026-10', { dividend: '9.00', total: '9.00' }),
    ],
    total_12m: '1120.50',
    upcoming: [
      {
        transaction_id: '99991111-1111-4111-8111-111111111111',
        settlement_date: '2026-10-20',
        payout_kind: 'jcp',
        net_amount: '96.12',
      },
    ],
  },
  transactions: {
    recent: [
      transaction({
        id: '00000001-1111-4111-8111-111111111111',
        kind: 'payout',
        payout_kind: 'jcp',
        trade_date: '2026-10-20',
        net_amount: '96.12',
        confirmed_at: null,
      }),
      transaction({
        id: '00000002-1111-4111-8111-111111111111',
        kind: 'payout',
        payout_kind: 'dividend',
        trade_date: '2026-10-01',
        net_amount: '9.00',
      }),
      transaction({
        id: '00000003-1111-4111-8111-111111111111',
        kind: 'buy',
        trade_date: '2026-06-10',
        quantity: '50',
        unit_price: '35.10',
        net_amount: '1755.00',
      }),
      transaction({
        id: '00000004-1111-4111-8111-111111111111',
        kind: 'buy',
        trade_date: '2026-01-15',
        quantity: '100',
        unit_price: '33.80',
        net_amount: '3380.00',
      }),
      transaction({
        id: '00000005-1111-4111-8111-111111111111',
        kind: 'buy',
        trade_date: '2025-03-12',
        quantity: '100',
        unit_price: '31.40',
        net_amount: '3140.00',
      }),
    ],
    total: 24,
    facets: [
      { kind: 'buy', count: 18 },
      { kind: 'payout', count: 6 },
    ],
  },
  corporate_events: [],
  portfolios: [
    {
      portfolio_id: '11111111-1111-4111-8111-111111111111',
      portfolio_name: 'Longo prazo',
      quantity: '500',
      value: '18420.00',
    },
  ],
  custodians: [
    {
      institution_id: 'bbbb1111-1111-4111-8111-111111111111',
      institution_name: 'Corretora A',
    },
  ],
  ...overrides,
});

function month(
  key: string,
  over: Partial<AssetPageResource['payouts']['months'][number]> = {},
): AssetPageResource['payouts']['months'][number] {
  return {
    month: key,
    dividend: '0',
    jcp: '0',
    income: '0',
    interest: '0',
    amortization: '0',
    total: '0',
    ...over,
  };
}

function transaction(
  over: Partial<AssetPageResource['transactions']['recent'][number]> & { id: string },
): AssetPageResource['transactions']['recent'][number] {
  return {
    kind: 'buy',
    payout_kind: null,
    trade_date: '2026-06-10',
    settlement_date: '2026-06-12',
    quantity: '0',
    unit_price: '0',
    net_amount: '0',
    fees: '0',
    confirmed_at: '2026-06-12T12:00:00.000Z',
    portfolio_id: '11111111-1111-4111-8111-111111111111',
    portfolio_name: 'Longo prazo',
    institution_name: 'Corretora A',
    ...over,
  };
}

/**
 * O sinal vai em um `span` próprio, para a coluna alinhar pela vírgula (D-02).
 * O texto inteiro só existe no elemento que contém os dois, então a busca é
 * pelo `textContent` em vez de pelo nó de texto.
 */
const signed =
  (text: string) =>
  (_: string, element: Element | null): boolean =>
    element?.textContent === text;

const calls: string[] = [];
const back: number[] = [];

const answerWith = (body: AssetPageResource | { status: number }): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input);
      calls.push(url);

      if ('status' in body) {
        return Promise.resolve({
          ok: false,
          status: body.status,
          json: () => Promise.resolve({ message: 'Ativo não encontrado' }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      } as Response);
    }),
  );
};

const show = (initial = '/longo-prazo/ativo/itub4', width = 1440) => {
  // O jsdom mede tudo como zero; a largura é informada, como na galeria.
  Object.defineProperty(globalThis, 'innerWidth', { value: width, writable: true });

  return render(
    <MemoryRouter initialEntries={[initial]}>
      <PreferencesProvider storage={null}>
        <ShortcutProvider>
          <AssetScreen
            assetRef="itub4"
            portfolioId="11111111-1111-4111-8111-111111111111"
            scopeLabel="Longo prazo"
            onBack={() => back.push(1)}
          />
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  calls.length = 0;
  back.length = 0;
  answerWith(resource());
});

afterEach(() => vi.unstubAllGlobals());

describe('o cabeçalho', () => {
  it('traz o papel, o preço do dia e a procedência dele', async () => {
    show();

    expect(await screen.findByRole('heading', { name: 'ITUB4' })).toBeInTheDocument();
    expect(screen.getByText('Itaú Unibanco PN')).toBeInTheDocument();
    expect(screen.getByText('R$ 36,84')).toBeInTheDocument();
    expect(screen.getAllByText(signed('+0,82%')).length).toBeGreaterThan(0);
    expect(screen.getByText(/B3 06\/10/)).toBeInTheDocument();
  });

  it('as pastilhas dizem categoria, setor e onde está custodiado', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getAllByText('Ações').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bancos').length).toBeGreaterThan(0);
    expect(screen.getByText('Corretora A')).toBeInTheDocument();
  });

  it('a página não tem trilha: a navegação lateral já leva a Posições', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.queryByRole('navigation', { name: 'Trilha' })).not.toBeInTheDocument();
  });
});

describe('a posição', () => {
  it('mostra exatamente as oito linhas pedidas', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    const bloco = screen.getByText(/Sua posição/).closest('div');
    expect(bloco).not.toBeNull();
    const dentro = within(bloco as HTMLElement);

    const labels = [
      'Quantidade',
      'Preço médio',
      'Valor investido',
      'Valor atualizado',
      'Rentabilidade (TWR)',
      'Rentabilidade (TIR)',
      'Peso na carteira',
      'Tipo do ativo',
    ];
    for (const label of labels) expect(dentro.getByText(label)).toBeInTheDocument();
    expect(bloco?.querySelectorAll('dt')).toHaveLength(labels.length);

    expect(dentro.getByText('500')).toBeInTheDocument();
    expect(dentro.getByText('R$ 29,10')).toBeInTheDocument();
    expect(dentro.getByText('R$ 14.550,00')).toBeInTheDocument();
    expect(dentro.getByText('R$ 18.420,00')).toBeInTheDocument();
    expect(dentro.getAllByText(signed('+23,1%')).length).toBeGreaterThan(0);
    expect(dentro.getAllByText(signed('+18,4%')).length).toBeGreaterThan(0);
    expect(dentro.getByText('5,8%')).toBeInTheDocument();
    expect(dentro.getByText('Ação')).toBeInTheDocument();
  });

  it('posição zerada diz isso, em vez de mostrar seis zeros', async () => {
    answerWith(resource({ position: null }));
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText(/Posição zerada/)).toBeInTheDocument();
    expect(screen.queryByText('Preço médio')).not.toBeInTheDocument();
  });

  it('papel vendido ainda mostra o que rendeu na carteira', async () => {
    answerWith(
      resource({
        position: null,
        lifetime: {
          ...resource().lifetime,
          invested: '4000.00',
          proceeds: '4500.00',
          sells: 1,
          realized_result: '500.00',
          payouts_received: '120.00',
        },
      }),
    );
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText('Valor investido')).toBeInTheDocument();
    expect(screen.getByText('R$ 4.000,00')).toBeInTheDocument();
    expect(screen.getByText('Valor vendido')).toBeInTheDocument();
    expect(screen.getByText('Resultado realizado')).toBeInTheDocument();
    expect(screen.getAllByText(signed('+R$ 500,00')).length).toBeGreaterThan(0);
    expect(screen.getByText('Proventos recebidos')).toBeInTheDocument();
    expect(screen.getByText('Rentabilidade (TWR)')).toBeInTheDocument();
    expect(screen.getByText('Rentabilidade (TIR)')).toBeInTheDocument();
  });

  it('sem consolidação nenhuma, a frase é outra: o problema está em outro lugar', async () => {
    answerWith(resource({ position: null, as_of: null }));
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText(/Carteira ainda não consolidada/)).toBeInTheDocument();
  });

  it('título na curva mostra o valor na curva, e não quantidade e preço médio', async () => {
    answerWith(
      resource({
        position: {
          ...resource().position!,
          unit: 'curve',
          quantity: null,
          avg_price: null,
          accrued_interest: '1380.00',
          value: '16500.00',
          cost_basis: '15120.00',
        },
      }),
    );
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText('Valor na curva')).toBeInTheDocument();
    expect(screen.getByText('Juros acumulados')).toBeInTheDocument();
    expect(screen.queryByText('Quantidade')).not.toBeInTheDocument();
    expect(screen.queryByText('Preço médio')).not.toBeInTheDocument();
  });
});

describe('o gráfico de preço', () => {
  it('a janela vai para a URL, e o padrão não', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    await userEvent.click(screen.getByRole('radio', { name: '3A' }));

    await waitFor(() => expect(calls.at(-1)).toContain('period=3a'));
    // O padrão não é escrito: `/ativo/itub4` já é a janela de um ano.
    expect(calls[0]).toContain('period=1a');
  });

  it('a variação da janela vem com e sem provento, como a prancha mostra', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getAllByText(signed('+17,5%')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(signed('+21,4%')).length).toBeGreaterThan(0);
    expect(screen.getByText('com proventos')).toBeInTheDocument();
  });

  it('as compras aparecem marcadas sobre a linha', async () => {
    const { container } = show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(container.querySelectorAll('[data-marker]')).toHaveLength(2);
  });

  it('o preço médio aparece como linha de referência rotulada', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText('PM 29,10')).toBeInTheDocument();
  });

  it('série com menos de dois pontos não é desenhada, e a tela diz por quê', async () => {
    answerWith(
      resource({
        series: { ...resource().series, points: [], return_ratio: null },
      }),
    );
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    const aviso = screen.getByText(/Ainda não há preço deste papel/);
    expect(aviso).toBeInTheDocument();
    // Nenhum gráfico de preço: o painel de proventos tem o seu, e é por isso
    // que a busca é dentro do bloco, e não no documento inteiro.
    expect(aviso.closest('section')?.querySelector('svg')).toBeNull();
  });

  it('janela maior que o histórico devolve traço, e não um número inventado', async () => {
    answerWith(
      resource({
        series: {
          ...resource().series,
          return_ratio: null,
          return_with_payouts_ratio: null,
        },
      }),
    );
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText(/histórico curto demais/)).toBeInTheDocument();
  });

  it('a série ajustada por evento diz isso na legenda', async () => {
    answerWith(resource({ series: { ...resource().series, adjusted: true } }));
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText('série ajustada por evento')).toBeInTheDocument();
  });
});

describe('os proventos', () => {
  it('o subtítulo traz o yield sobre custo, e o painel o total recebido', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText(/yield sobre custo 7,7%/)).toBeInTheDocument();
    expect(screen.getByText('Total 12M')).toBeInTheDocument();
  });

  it('o provento a receber aparece com a data e o valor', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText(/JCP · a receber/)).toBeInTheDocument();
    expect(screen.getByText('20/10')).toBeInTheDocument();
    expect(screen.getAllByText(signed('+R$ 96,12')).length).toBeGreaterThan(0);
  });

  it('papel sem provento diz isso, em vez de desenhar doze barras de zero', async () => {
    answerWith(
      resource({
        payouts: {
          months: resource().payouts.months.map((m) => month(m.month)),
          total_12m: '0',
          upcoming: [],
        },
        position: { ...resource().position!, yield_on_cost_12m: null },
      }),
    );
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText(/não pagou provento/)).toBeInTheDocument();
    expect(screen.queryByText(/yield sobre custo/)).not.toBeInTheDocument();
  });
});

describe('o histórico', () => {
  it('traz data, tipo, quantidade, preço e valor em uma linha por lançamento', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByText('10/06/2026')).toBeInTheDocument();
    // A coluna é inteira de reais e por isso não repete o `R$`, como a prancha
    // escreve: o cabeçalho já diz que é valor.
    expect(screen.getAllByText(signed('R$ 1.755,00')).length).toBeGreaterThan(0);
    const compra = screen.getByText('10/06/2026').closest('tr') as HTMLElement;
    expect(within(compra).getByText('50')).toBeInTheDocument();
    expect(within(compra).getByText(signed('R$ 35,10'))).toBeInTheDocument();
    expect(screen.getAllByText(signed('+R$ 96,12')).length).toBeGreaterThan(0);
    expect(screen.getByText('24 lançamentos')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Histórico' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Lançamentos' }),
    ).not.toBeInTheDocument();
  });

  it('cada linha tem o menu de ações de Movimentações', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(
      screen.getAllByRole('button', { name: /^Ações de (Compra|Provento)/ }).length,
    ).toBe(5);
  });

  it('provento não mostra "0 × R$ 0,00": a coluna não se aplica a ele', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    const linha = screen.getByText('20/10/2026').closest('tr');
    expect(within(linha as HTMLElement).getByText('—')).toBeInTheDocument();
    // "A receber" não ocupa coluna aqui — ele está no bloco de Proventos, onde
    // a prancha o põe —, e a linha inteira o diz na dica.
    expect(linha).toHaveAttribute('title', expect.stringContaining('a receber'));
  });

  it('o filtro de tipo vai para a api, não é aplicado aqui', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    await userEvent.click(screen.getByRole('button', { name: /Compra18/ }));

    await waitFor(() => expect(calls.at(-1)).toContain('kind=buy'));
  });

  it('a contagem de cada opção é de antes do filtro, para ela não se apagar', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(screen.getByRole('button', { name: /Todos24/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Compra18/ })).toBeInTheDocument();
  });
});

describe('os dados do ativo', () => {
  it('o card "Dados do ativo" não existe mais', async () => {
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    expect(
      screen.queryByRole('heading', { name: 'Dados do ativo' }),
    ).not.toBeInTheDocument();
  });
});

describe('o que ainda não existe', () => {
  it('Lançar abre o modal de compra já neste ativo', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('heading', { name: 'ITUB4' });

    await user.click(screen.getByRole('button', { name: /Lançar/ }));

    expect(entry.openEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: 'buy',
        asset: expect.objectContaining({ label: 'ITUB4' }),
      }),
    );
  });
});

describe('o endereço velho', () => {
  it('ativo inexistente diz que não existe, e não que a api caiu', async () => {
    answerWith({ status: 404 });
    show();

    expect(await screen.findByText('Este ativo não existe')).toBeInTheDocument();
    expect(screen.getByText(/ITUB4/)).toBeInTheDocument();
  });

  it('a api fora do ar é outro problema, e a frase é outra', async () => {
    answerWith({ status: 500 });
    show();

    expect(await screen.findByText('Não deu para abrir o ativo')).toBeInTheDocument();
  });
});

describe('título de renda fixa', () => {
  const base = resource();
  const cdb = resource({
    asset: {
      ...base.asset,
      ticker: 'CDB-ITAU-20311001',
      name: 'CDB · ITAÚ UNIBANCO · 10/2031 · 100% CDI',
      origin: 'manual',
      b3_type: null,
      indexer: 'cdi_pct',
      rate: '100.0000',
      issued_at: '2024-10-01',
      maturity_date: '2031-10-01',
      liquidity: 'at_maturity',
      tax_regime: 'regressive',
    },
    price: { value: null, day_change_ratio: null, price_health: null, price_date: null },
    series: {
      ...base.series,
      points: [],
      marks: [],
      value_points: [
        {
          date: '2026-09-01',
          cost_basis: '1000.00',
          value: '1100.00',
          result: '100.00',
          payouts: '0.00',
          with_payouts: '1100.00',
          result_with_payouts: '100.00',
        },
        {
          date: '2026-10-01',
          cost_basis: '1000.00',
          value: '1112.00',
          result: '112.00',
          payouts: '0.00',
          with_payouts: '1112.00',
          result_with_payouts: '112.00',
        },
      ],
    },
  });

  it('o gráfico é o do rendimento acumulado, e não o do preço', async () => {
    answerWith(cdb);
    show();

    expect(
      await screen.findByRole('heading', { name: /Rendimento acumulado em/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Preço em/ })).not.toBeInTheDocument();
  });

  it('a evolução da posição separa investido de rendimento', async () => {
    answerWith(cdb);
    show();

    expect(await screen.findByText('Evolução da posição')).toBeInTheDocument();
  });

  it('o nome do título aparece uma vez, e as condições dele na posição', async () => {
    answerWith(cdb);
    show();

    await screen.findByRole('heading', { name: /Rendimento acumulado em/ });

    expect(screen.getAllByText('CDB · ITAÚ UNIBANCO · 10/2031 · 100% CDI')).toHaveLength(
      1,
    );
    expect(screen.getByText('Vencimento')).toBeInTheDocument();
    expect(screen.queryByText('Preço médio')).not.toBeInTheDocument();
  });
});
