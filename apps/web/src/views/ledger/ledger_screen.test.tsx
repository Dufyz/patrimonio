import { render, screen, waitFor } from '@testing-library/react';
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
      <MemoryRouter initialEntries={['/livro?q=zzz']}>
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
    expect(screen.getByText('Saldo do mês')).toBeTruthy();
    expect(screen.getByText('2 previstos até 30/11')).toBeTruthy();
    expect(screen.getByText(/Próximos dias · previstos/)).toBeTruthy();
    expect(screen.getByText('venceu em 05/01')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeTruthy();
  });
});
