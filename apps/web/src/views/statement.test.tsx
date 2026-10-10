import type { StatementResource, StatementRow } from '@patrimonio/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import { ShortcutProvider } from '../components/shortcuts.js';
import { StatementScreen } from './statement.js';

const entry = vi.hoisted(() => ({
  openEntry: vi.fn(),
  openEdit: vi.fn(),
  openConfirmPayout: vi.fn(),
  version: 0,
}));

vi.mock('../components/entry_provider.js', () => ({ useEntry: () => entry }));

/**
 * T-04 · A tela contra a prancha 07.
 *
 * Os números são os da prancha. O que estes testes protegem é o que quebraria
 * em silêncio: o subtotal do mês que deixa de ser o da `api`, o filtro que não
 * chega nela, a exclusão que some da tela sem a `api` confirmar, o Efeito que
 * vaza com os valores ocultos.
 */

const ID = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (n: number, overrides: Partial<StatementRow>): StatementRow => ({
  id: ID(n),
  kind: 'buy',
  payout_kind: null,
  trade_date: '2026-09-30',
  settlement_date: '2026-10-02',
  portfolio_id: ID(900),
  portfolio_name: 'Longo prazo',
  institution_id: ID(800),
  institution_name: 'Corretora A',
  asset_id: ID(700 + n),
  ticker: 'WEGE3',
  asset_name: 'WEG ON',
  b3_type: 'stock',
  quantity: '100',
  unit_price: '31.20',
  fees: '0.00',
  gross_amount: '3120.00',
  tax_withheld: '0.00',
  net_amount: '-3120.00',
  confirmed_at: null,
  note: null,
  effect: { type: 'average_price', before: '38.20', after: '36.80' },
  ...overrides,
});

const ROWS: readonly StatementRow[] = [
  row(1, {
    kind: 'payout',
    payout_kind: 'income',
    trade_date: '2026-10-02',
    ticker: 'BTLG11',
    asset_name: 'BTG Logística',
    b3_type: 'fii',
    quantity: '140',
    unit_price: '0.91',
    gross_amount: '127.40',
    net_amount: '127.40',
    confirmed_at: '2026-10-02T12:00:00.000Z',
    effect: { type: 'payout_exempt' },
  }),
  row(2, {
    kind: 'deposit',
    trade_date: '2026-10-01',
    ticker: null,
    asset_name: null,
    asset_id: null,
    b3_type: null,
    quantity: '0',
    unit_price: '0',
    net_amount: '4000.00',
    effect: { type: 'cash_in' },
  }),
  row(3, {}),
  row(4, {
    ticker: 'HGLG11',
    asset_name: 'CSHG Logística',
    b3_type: 'fii',
    trade_date: '2026-09-25',
    quantity: '10',
    unit_price: '160.10',
    net_amount: '-1601.00',
    effect: { type: 'average_price', before: '158.01', after: '158.20' },
  }),
  row(5, {
    kind: 'sell',
    ticker: 'VALE3',
    asset_name: 'Vale ON',
    trade_date: '2026-09-22',
    quantity: '50',
    unit_price: '57.90',
    net_amount: '2895.00',
    effect: { type: 'realized', result: '-310.00', exempt: false },
  }),
];

const resource = (overrides: Partial<StatementResource> = {}): StatementResource => ({
  scope: {
    portfolio_id: ID(900),
    portfolio_name: 'Longo prazo',
    entries_total: 312,
    first_trade_date: '2021-03-05',
  },
  summary: {
    count: 10,
    deposits: '11400.00',
    withdrawals: '0.00',
    buys: '5721.00',
    sells: '2895.00',
    payouts: '553.55',
  },
  facets: [
    { group: 'buy', count: 3 },
    { group: 'sell', count: 1 },
    { group: 'payout', count: 4 },
    { group: 'cash', count: 2 },
    { group: 'event', count: 0 },
  ],
  facets_total: 10,
  institutions: [
    { id: ID(800), name: 'Corretora A', count: 300 },
    { id: ID(801), name: 'Tesouro Direto', count: 12 },
  ],
  months: [
    {
      month: '2026-10',
      count: 2,
      deposits: '4000.00',
      withdrawals: '0.00',
      buys: '0.00',
      sells: '0.00',
      payouts: '127.40',
    },
    {
      month: '2026-09',
      count: 8,
      deposits: '7400.00',
      withdrawals: '0.00',
      buys: '5721.00',
      sells: '2895.00',
      payouts: '426.15',
    },
  ],
  page: { number: 1, limit: 50, total: 10 },
  rows: ROWS as StatementRow[],
  earlier: { month: '2026-08', count: 14 },
  recalculation: { pending: 0, failed: 0 },
  ...overrides,
});

type Call = { readonly method: string; readonly url: string; readonly body: unknown };
const calls: Call[] = [];

const answer = (
  body: StatementResource,
  writes: Readonly<Record<string, unknown>> = {},
): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const url = String(input);
      calls.push({
        method,
        url,
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      });

      const payload =
        method === 'GET'
          ? body
          : (writes[`${method} ${url.replace(/[0-9a-f-]{36}/g, ':id')}`] ?? {});
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(payload),
      } as Response);
    }),
  );
};

const DELETED = {
  deleted: {},
  undo: { undo_id: ID(500), expires_at: '2999-01-01T00:00:00.000Z' },
  recalculation: [{ job_id: 'j1' }],
};

const opened: string[] = [];

const show = (initial = '/longo-prazo/movimentacoes') => {
  Object.defineProperty(globalThis, 'innerWidth', { value: 1440, writable: true });

  return render(
    <MemoryRouter initialEntries={[initial]}>
      <PreferencesProvider storage={null}>
        <ShortcutProvider>
          <StatementScreen
            portfolioId={ID(900)}
            scopeLabel="Longo prazo"
            portfolios={[
              { id: ID(900), name: 'Longo prazo' },
              { id: ID(901), name: 'Reserva' },
            ]}
            onOpenAsset={(slug) => opened.push(slug)}
          />
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

const gets = (): string[] =>
  calls.filter((call) => call.method === 'GET').map((call) => call.url);

beforeEach(() => {
  calls.length = 0;
  opened.length = 0;
  answer(resource());
});

afterEach(() => vi.unstubAllGlobals());

describe('tela de Movimentações', () => {
  it('o cabeçalho diz quantos lançamentos o escopo tem desde quando', async () => {
    show();
    expect(
      await screen.findByText(/312 lançamentos desde mar\/2021/),
    ).toBeInTheDocument();
  });

  it('o resumo do período é o da api', async () => {
    show();
    const list = await screen.findByLabelText('Resumo do período');

    expect(within(list).getByText('R$ 11.400,00')).toBeInTheDocument();
    expect(within(list).getByText('R$ 5.721,00')).toBeInTheDocument();
    expect(within(list).getByText('R$ 2.895,00')).toBeInTheDocument();
    expect(within(list).getByText('R$ 553,55')).toBeInTheDocument();
    expect(within(list).getByText('· 10 lançamentos')).toBeInTheDocument();
    // Sem resgate no recorte, a quinta medida não existe.
    expect(within(list).queryByText('resgates')).toBeNull();
  });

  it('o subtotal do mês vem da api e omite o que é zero', async () => {
    show();
    const october = (await screen.findByText('Outubro 2026')).closest(
      'tr',
    ) as HTMLElement;
    expect(within(october).getByText(/aportes/)).toBeInTheDocument();
    expect(within(october).getByText(/proventos/)).toBeInTheDocument();
    expect(within(october).queryByText(/compras/)).toBeNull();

    const september = (await screen.findByText('Setembro 2026')).closest(
      'tr',
    ) as HTMLElement;
    expect(within(september).getByText('7.400,00')).toBeInTheDocument();
    expect(within(september).getByText('426,15')).toBeInTheDocument();
  });

  it('a coluna Efeito diz o que cada lançamento mudou', async () => {
    show();
    expect(await screen.findByText('PM 38,20 → 36,80')).toBeInTheDocument();
    expect(screen.getByText('PM 158,01 → 158,20')).toBeInTheDocument();
    expect(screen.getByText('−310,00 realizado')).toBeInTheDocument();
    expect(screen.getByText('isento de IR')).toBeInTheDocument();
    expect(screen.getByText('vindo de fora do app')).toBeInTheDocument();
  });

  it('aporte aparece como Caixa da instituição, sem quantidade nem preço', async () => {
    show();
    const line = (await screen.findByText('Caixa · Corretora A')).closest(
      'tr',
    ) as HTMLElement;
    expect(line).toHaveTextContent('+4.000,00');
    expect(within(line).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('as pastilhas mostram a contagem e escondem Eventos quando não há', async () => {
    show();
    const group = await screen.findByRole('group', { name: 'Filtrar por tipo' });
    expect(within(group).getByRole('button', { name: /Todos\s*10/ })).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: /Proventos\s*4/ }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: /Aportes e resgates\s*2/ }),
    ).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: /Eventos/ })).toBeNull();
  });

  it('o filtro de tipo vai para a api, e não para um filtro local', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Outubro 2026');

    await user.click(screen.getByRole('button', { name: /Compras\s*3/ }));

    await waitFor(() =>
      expect(gets().some((url) => url.includes('group=buy'))).toBe(true),
    );
    expect(gets().at(-1)).toContain('portfolio_id=');
  });

  it('a URL de entrada já aplica o filtro', async () => {
    show('/longo-prazo/movimentacoes?grupo=proventos&periodo=inicio');
    await screen.findByText('Outubro 2026');

    expect(gets()[0]).toContain('group=payout');
  });

  it('marcar linhas abre a barra de lote e limpar a fecha', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Outubro 2026');

    await user.click(screen.getByLabelText(/Selecionar Compra de WEGE3/));
    await user.click(screen.getByLabelText(/Selecionar Compra de HGLG11/));

    const bar = screen.getByRole('toolbar', { name: 'Ações em lote' });
    expect(within(bar).getByText('2 selecionados')).toBeInTheDocument();
    expect(within(bar).getByText(/2 compras/)).toBeInTheDocument();
    // Duplicar existe e diz por que não funciona ainda.
    expect(within(bar).getByRole('button', { name: 'Duplicar' })).toBeDisabled();

    await user.click(within(bar).getByRole('button', { name: 'Limpar seleção' }));
    expect(screen.queryByRole('toolbar', { name: 'Ações em lote' })).toBeNull();
  });

  it('o cabeçalho marca e desmarca a página inteira', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Outubro 2026');

    const master = screen.getByLabelText('Selecionar todos os lançamentos da página');
    await user.click(master);
    expect(screen.getByText('5 selecionados')).toBeInTheDocument();
    await user.click(master);
    expect(screen.queryByText('5 selecionados')).toBeNull();
  });

  it('excluir pede à api, avisa do recálculo e oferece desfazer', async () => {
    const user = userEvent.setup();
    answer(resource(), { 'DELETE /api/transactions/:id': DELETED });
    show();
    await screen.findByText('Outubro 2026');

    await user.click(screen.getByLabelText(/Selecionar Venda de VALE3/));
    await user.click(
      within(screen.getByRole('toolbar', { name: 'Ações em lote' })).getByRole('button', {
        name: 'Excluir',
      }),
    );

    expect(
      await screen.findByText(/1 lançamento excluído\. Recálculo enfileirado/),
    ).toBeInTheDocument();
    expect(
      calls.some((call) => call.method === 'DELETE' && call.url.endsWith(ID(5))),
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' && call.url === `/api/transactions/undo/${ID(500)}`,
        ),
      ).toBe(true),
    );
    expect(
      await screen.findByText('Exclusão desfeita. Recálculo enfileirado.'),
    ).toBeInTheDocument();
  });

  it('a exclusão que a api recusa não finge ter acontecido', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'DELETE'
            ? ({
                ok: false,
                status: 409,
                json: () => Promise.resolve({ message: 'conflito' }),
              } as Response)
            : ({
                ok: true,
                status: 200,
                json: () => Promise.resolve(resource()),
              } as Response),
        ),
      ),
    );
    show();
    await screen.findByText('Outubro 2026');

    await user.click(screen.getByLabelText(/Selecionar Venda de VALE3/));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    expect(
      await screen.findByText('Não foi possível excluir. Nada foi alterado.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull();
  });

  it('mover para outra carteira manda o PATCH com a carteira escolhida', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Outubro 2026');

    await user.click(screen.getByLabelText(/Selecionar Compra de HGLG11/));
    await user.click(screen.getByRole('button', { name: 'Mover para carteira' }));

    const dialog = await screen.findByRole('dialog');
    // A carteira de origem não é destino.
    expect(within(dialog).queryByRole('option', { name: 'Longo prazo' })).toBeNull();
    await user.selectOptions(within(dialog).getByRole('combobox'), 'Reserva');
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.url).toBe(`/api/transactions/${ID(4)}`);
    expect(patch?.body).toEqual({ portfolio_id: ID(901) });
    expect(
      await screen.findByText(/1 lançamento movido\. Recálculo enfileirado/),
    ).toBeInTheDocument();
  });

  it('exportar gera o CSV da seleção', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob);
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    show();
    await screen.findByText('Outubro 2026');
    await user.click(screen.getByLabelText(/Selecionar Venda de VALE3/));
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    expect(click).toHaveBeenCalledOnce();
    const text = await blobs[0]?.text();
    expect(text).toContain('VALE3');
    expect(text).toContain('−310,00 realizado');
    expect(text).not.toContain('WEGE3');
    click.mockRestore();
  });

  it('o menu da linha abre o ativo e oferece excluir por último', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Outubro 2026');

    await user.click(screen.getByRole('button', { name: /Ações de Venda de VALE3/ }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items.at(-1)).toHaveTextContent('Excluir');
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: /Editar/ }),
    ).toBeEnabled();

    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Abrir ativo' }),
    );
    expect(opened).toEqual(['vale3']);
  });

  it('"Ampliar o período" pede o mês anterior inteiro', async () => {
    const user = userEvent.setup();
    show();

    await user.click(
      await screen.findByRole('button', { name: /Ampliar o período para agosto/ }),
    );

    expect(screen.getByRole('button', { name: /14 lançamentos/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(gets().some((url) => url.includes('from=2026-08-01'))).toBe(true),
    );
  });

  it('sem nada para trás, o link não existe', async () => {
    answer(resource({ earlier: null }));
    show();
    await screen.findByText('Outubro 2026');
    expect(screen.queryByRole('button', { name: /Ampliar o período/ })).toBeNull();
  });

  it('recálculo pendente avisa que o Efeito vai mudar', async () => {
    answer(resource({ recalculation: { pending: 1, failed: 0 } }));
    show();
    expect(await screen.findByText(/Recálculo em andamento/)).toBeInTheDocument();
  });

  it('recálculo que falhou é dito, não escondido', async () => {
    answer(resource({ recalculation: { pending: 0, failed: 2 } }));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent(/falhou em 2 carteiras/);
  });

  it('recorte vazio por filtro oferece limpar; vazio sem filtro não', async () => {
    const user = userEvent.setup();
    answer(resource({ rows: [], months: [], earlier: null, facets_total: 0 }));
    show('/longo-prazo/movimentacoes?grupo=vendas');

    expect(
      await screen.findByText('Nenhum lançamento corresponde ao filtro.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(
      await screen.findByText('Nenhum lançamento neste período.'),
    ).toBeInTheDocument();
  });

  it('com mais de uma página, o rodapé navega e pede a página certa', async () => {
    const user = userEvent.setup();
    answer(resource({ page: { number: 1, limit: 50, total: 120 } }));
    show();

    expect(await screen.findByText(/Página 1 de 3/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(gets().some((url) => url.includes('page=2'))).toBe(true));
  });

  it('api fora do ar vira erro nomeado, não tabela vazia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () =>
            Promise.resolve({ message: 'banco indisponível', request_id: 'r1' }),
        } as Response),
      ),
    );
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('banco indisponível');
  });
});
