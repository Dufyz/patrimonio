import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { AccountsScreen } from './accounts_screen.js';

const account = (
  id: string,
  name: string,
  balance: string,
  projected: string,
  extra: Record<string, unknown> = {},
) => ({
  account: {
    id,
    name,
    type: 'corrente',
    institution: 'Banco',
    role: 'Papel',
    in_wealth: true,
    archived: false,
    ...extra,
  },
  balance,
  variation: '0',
  cards: id === 'a1' ? ['Roxinho'] : [],
  projected_month_end: projected,
});

const body = {
  accounts: [
    account('a1', 'Nubank Conta', '1022.86', '200.00'),
    account('a2', 'Itaú Unibanco', '439.65', '100.00'),
    account('a3', 'Flash LifeApps', '0.00', '0.00', { in_wealth: false }),
  ],
  total_balance: '1462.51',
  projected_total: '300.00',
  as_of: '2026-11-11',
};

afterEach(() => vi.unstubAllGlobals());

describe('AccountsScreen', () => {
  it('mostra saldo, previsto, total e o subtítulo com a data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    render(
      <MemoryRouter>
        <PreferencesProvider>
          <AccountsScreen />
        </PreferencesProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Nubank Conta')).toBeTruthy());
    expect(screen.getByText(/saldos de 11\/11\/2026/)).toBeTruthy();
    expect(screen.getByText('Total em contas')).toBeTruthy();
    expect(screen.getAllByText(/1\.462,51/).length).toBeGreaterThan(0);
    expect(screen.getByText('Roxinho')).toBeTruthy();
    expect(screen.getByText('○ Não')).toBeTruthy();
  });

  it('clicar no cabeçalho ordena, o segundo clique inverte e o terceiro volta à ordem da tela (CMP-03)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    render(
      <MemoryRouter>
        <PreferencesProvider>
          <AccountsScreen />
        </PreferencesProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Nubank Conta')).toBeTruthy());

    const names = (): string[] =>
      within(screen.getAllByRole('table')[0] as HTMLElement)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent?.replace('Papel', '') ?? '')
        .filter((name) => name !== 'Total em contas');
    const header = (): HTMLElement =>
      screen.getByRole('columnheader', { name: /Saldo hoje/ });
    const click = () => userEvent.click(within(header()).getByRole('button'));

    expect(names()).toEqual(['Nubank Conta', 'Itaú Unibanco', 'Flash LifeApps']);
    expect(header().getAttribute('aria-sort')).toBe('none');

    await click();
    expect(header().getAttribute('aria-sort')).toBe('ascending');
    expect(names()).toEqual(['Flash LifeApps', 'Itaú Unibanco', 'Nubank Conta']);

    await click();
    expect(header().getAttribute('aria-sort')).toBe('descending');
    expect(names()).toEqual(['Nubank Conta', 'Itaú Unibanco', 'Flash LifeApps']);

    await click();
    expect(header().getAttribute('aria-sort')).toBe('none');
    expect(names()).toEqual(['Nubank Conta', 'Itaú Unibanco', 'Flash LifeApps']);
  });
});
