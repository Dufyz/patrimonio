import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from 'react-router';

import { PreferencesProvider } from '../../components/preferences.js';
import { LedgerScreen } from './ledger_screen.js';

const zero = { receitas: '0', despesas: '0', aportes: '0' };
const book = {
  range: { from: '2026-11-01', to: '2026-11-30' },
  rows: [
    {
      id: '1',
      kind: 'RECEITA',
      date: '2026-11-11',
      situation: 'lancado',
      description: 'Salário',
      amount: '5000',
      account_id: 'a',
      to_account_id: null,
      card_id: null,
      category_id: null,
      portfolio_id: null,
      asset_id: null,
      asset_class: null,
      quantity: null,
      unit_price: null,
      fees: null,
      entry: null,
      event_id: null,
    },
    {
      id: '2',
      kind: 'DESPESA',
      date: '2020-01-05',
      situation: 'previsto',
      description: 'Aluguel',
      amount: '1500',
      account_id: 'a',
      to_account_id: null,
      card_id: null,
      category_id: null,
      portfolio_id: null,
      asset_id: null,
      asset_class: null,
      quantity: null,
      unit_price: null,
      fees: null,
      entry: {},
      event_id: null,
    },
  ],
  next_cursor: null,
  totals: {
    receitas: '5000',
    despesas: '0',
    aportes: '0',
    saldo_do_mes: '5000',
    previsto: zero,
    a_lancar: 2,
  },
  count: 1,
  groups: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('LedgerScreen', () => {
  it('mostra a faixa e a linha do dia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(book), { status: 200 })),
    );
    render(
      <MemoryRouter initialEntries={['/lancamentos?q=zzz']}>
        <PreferencesProvider>
          <LedgerScreen />
        </PreferencesProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Salário')).toBeTruthy());
    expect(screen.getByText('Quarta, 11/11')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Remover filtro Busca: zzz/ }),
    ).toBeTruthy();
    expect(screen.getByRole('search')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Selecionar Salário'));
    expect(screen.getByRole('toolbar', { name: 'Ações em lote' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByText('Saldo do mês')).toBeTruthy();
    expect(screen.getByText('2 previstos até 30/11')).toBeTruthy();
    expect(screen.getByText(/Próximos dias · previstos/)).toBeTruthy();
    expect(screen.getByText('venceu em 05/01')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeTruthy();
  });

  it('NAV-12: cada célula da faixa é um link "abrir lista" que filtra a própria tabela', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(book), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/lancamentos?mes=2026-10']}>
        <PreferencesProvider>
          <LedgerScreen />
        </PreferencesProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Salário')).toBeTruthy());
    const href = (name: string): string =>
      screen.getByRole('link', { name: `abrir lista: ${name}` }).getAttribute('href') ??
      '';
    expect(href('Receitas')).toBe(
      '/lancamentos?tipo=RECEITA&situacao=lancado&mes=2026-10',
    );
    expect(href('Despesas')).toBe(
      '/lancamentos?tipo=DESPESA&situacao=lancado&mes=2026-10',
    );
    expect(href('Aportes')).toBe('/lancamentos?tipo=APORTE&situacao=lancado&mes=2026-10');
    expect(href('A lançar')).toBe('/lancamentos?situacao=previsto&mes=2026-10');
    // O período da URL é o que a tela pede ao livro.
    expect(fetchMock.mock.calls.some((c) => JSON.stringify(c).includes('2026-10'))).toBe(
      true,
    );
  });

  const wrap = (): void => {
    render(
      <MemoryRouter initialEntries={['/lancamentos']}>
        <PreferencesProvider>
          <LedgerScreen />
        </PreferencesProvider>
      </MemoryRouter>,
    );
  };

  it('vazio sem filtros oferece Novo lançamento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...book, rows: [], count: 0 }), { status: 200 }),
      ),
    );
    wrap();
    await waitFor(() =>
      expect(screen.getByText('Nenhum lançamento no período')).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Novo lançamento' })).toBeTruthy();
  });

  it('erro mostra Tentar novamente e recarrega', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/book')) {
          calls += 1;
          return calls === 1
            ? new Response('{}', { status: 500 })
            : new Response(JSON.stringify(book), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );
    wrap();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByText('Salário')).toBeTruthy());
  });

  it('teclado: Espaço seleciona a linha em foco e Esc limpa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(book), { status: 200 })),
    );
    wrap();
    await waitFor(() => expect(screen.getByText('Salário')).toBeTruthy());
    const row = screen.getByText('Salário').closest('tr') as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: ' ' });
    expect(screen.getByRole('toolbar', { name: 'Ações em lote' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('LAN-08: Excluir em lote confirma com contagem e total, apaga e relê', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'DELETE') {
          calls.push(String(url));
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify(book), { status: 200 });
      }),
    );
    wrap();
    await waitFor(() => expect(screen.getByText('Salário')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Selecionar Salário'));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByText(/1 lançamento · valor total/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir', hidden: false }));
    await waitFor(() => expect(calls).toEqual(['/api/finance/entries/1']));
  });

  it('LAN-07: menu ⋯ da linha lançada exclui com confirmação; previsto não tem menu', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          calls.push(String(url));
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify(book), { status: 200 });
      }),
    );
    wrap();
    await waitFor(() => expect(screen.getByText('Salário')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Ações de Aluguel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Salário' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }));
    expect(screen.getByText(/1 lançamento · valor total/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(calls).toEqual(['/api/finance/entries/1']));
  });

  it('LAN-06: Lançar abre o modal com valor editável e confirma com data, valor e Idempotency-Key', async () => {
    const posted: { url: string; body: string; key: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posted.push({
            url: String(url),
            body: String(init.body),
            key: new Headers(init.headers).get('Idempotency-Key'),
          });
          return new Response('{}', { status: 200 });
        }
        return new Response(JSON.stringify(book), { status: 200 });
      }),
    );
    wrap();
    await waitFor(() => expect(screen.getByText('Aluguel')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    const amount = screen.getByLabelText('Valor real') as HTMLInputElement;
    expect(amount.value).toBe('15.00');
    fireEvent.change(amount, { target: { value: '16,50' } });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Lançar' }).at(-1) as HTMLElement,
    );
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.url).toBe('/api/finance/entries/2/confirm');
    expect(JSON.parse(posted[0]?.body ?? '{}')).toEqual({
      date: '2020-01-05',
      amount: '16.50',
    });
    expect(posted[0]?.key).toBeTruthy();
  });

  it('LAN-07: clicar na categoria de uma receita lançada abre o seletor e salva na hora', async () => {
    const puts: { url: string; body: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/finance/categories')) {
          return new Response(
            JSON.stringify({
              categories: [
                { id: 'c1', name: 'Receita fixa', kind: 'receita' },
                { id: 'c2', name: 'Mercado', kind: 'despesa' },
                { id: 'c3', name: 'Extras', kind: 'receita' },
              ],
            }),
            { status: 200 },
          );
        }
        if (init?.method === 'PUT') {
          puts.push({ url: String(url), body: String(init.body) });
          return new Response('{}', { status: 200 });
        }
        const [first, ...rest] = book.rows;
        const withEntry = {
          ...first,
          entry: {
            kind: 'receita',
            description: 'Salário',
            date: '2026-11-11',
            category_id: 'c1',
            amount: '5000',
            payments: [{ source_type: 'conta', source_id: 'a' }],
          },
          category_id: 'c1',
        };
        return new Response(JSON.stringify({ ...book, rows: [withEntry, ...rest] }), {
          status: 200,
        });
      }),
    );
    wrap();
    await waitFor(() => expect(screen.getByText('Salário')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Categoria de Salário/ }));
    fireEvent.change(screen.getByLabelText('Nova categoria de Salário'), {
      target: { value: 'c3' },
    });
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.url).toBe('/api/finance/entries/1');
    expect(JSON.parse(puts[0]?.body ?? '{}')).toMatchObject({ category_id: 'c3' });
  });
});
