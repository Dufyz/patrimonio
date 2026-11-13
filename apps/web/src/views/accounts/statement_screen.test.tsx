import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { AccountStatementScreen } from './statement_screen.js';

const statement = (closing: string) => ({
  account: {
    id: 'a1',
    name: 'Corrente',
    role: 'principal',
    institution: 'Itaú Unibanco',
  },
  range: { from: '2026-11-01', to: '2026-11-30' },
  opening: '100.00',
  entered: '50.00',
  left: '20.00',
  closing,
  through: '2026-11-13',
  lines: [
    {
      id: 'l1',
      date: '2026-11-02',
      origin: 'lancamento',
      description: 'Salário',
      note: null,
      category_id: 'c1',
      amount: '50.00',
      tags: [],
      entry_id: 'e1',
      balance_after: '150.00',
    },
    {
      id: 'l2',
      date: '2026-11-05',
      origin: 'lancamento',
      description: 'Mercado',
      note: null,
      category_id: null,
      amount: '-20.00',
      tags: [],
      entry_id: 'e2',
      balance_after: '130.00',
    },
  ],
});

const mount = (closing: string): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/categories')
        ? { categories: [{ id: 'c1', name: 'Salário', kind: 'receita' }] }
        : statement(closing);
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  render(
    <MemoryRouter initialEntries={['/contas-novo/a1']}>
      <Routes>
        <Route
          path="/contas-novo/:id"
          element={
            <PreferencesProvider>
              <AccountStatementScreen />
            </PreferencesProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AccountStatementScreen', () => {
  it('mostra da mais nova à mais antiga com o saldo após', async () => {
    mount('130.00');
    await screen.findByText('Mercado');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]?.textContent).toContain('Mercado');
    expect(rows[1]?.textContent).toContain('Salário');
    expect(screen.getByText(/Ver em Lançamentos com filtro desta conta/)).toBeTruthy();
  });

  it('não fecha: esconde os números e mostra o erro', async () => {
    mount('131.00');
    await screen.findByRole('alert');
    expect(screen.queryByText(/131/)).toBeNull();
  });
});

describe('StatementScreen · CTA-03/04', () => {
  it('mostra o gráfico com o menor saldo marcado e filtra sem mudar o saldo após', async () => {
    mount('130.00');
    await screen.findByText('Mercado');
    expect(screen.getByTestId('lowest')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Despesa' }));
    const rows = screen.getAllByRole('row');
    expect(rows.some((r) => r.textContent?.includes('Salário'))).toBe(false);
    expect(screen.getByText(/Total do período filtrado/)).toBeTruthy();
    expect(screen.getAllByText(/130,00/).length).toBeGreaterThan(0);
  });
});
