import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { AccountsCardsSection } from './accounts_cards.js';

const calls: { url: string; method: string }[] = [];

const account = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  account: {
    id,
    name,
    type: 'corrente',
    institution: 'Banco',
    role: 'Papel',
    opening_amount: '100.00',
    opening_date: '2026-01-01',
    in_wealth: true,
    archived: false,
    ...over,
  },
  balance: '0.00',
  variation: '0',
  cards: [],
  projected_month_end: '0.00',
});

const stub = (): void => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/finance/accounts'))
        return json({
          accounts: [
            account('a1', 'Nubank Conta'),
            account('a2', 'Antiga', { archived: true, in_wealth: false }),
          ],
          total_balance: '0.00',
          projected_total: '0.00',
          as_of: '2026-11-11',
        });
      if (url.endsWith('/finance/cards'))
        return json({
          cards: [
            {
              card: {
                id: 'c1',
                name: 'Roxinho',
                last4: '1234',
                pay_account_id: 'a1',
                limit_amount: '5000.00',
                closing_day: 20,
                due_day: 28,
              },
            },
          ],
        });
      return json({});
    }),
  );
};

afterEach(() => vi.unstubAllGlobals());

describe('Configurações · Contas e cartões (CFG-03)', () => {
  it('duas tabelas de cadastro com situação e conta pagadora', async () => {
    stub();
    render(
      <PreferencesProvider storage={null}>
        <AccountsCardsSection />
      </PreferencesProvider>,
    );
    const contas = within(
      await screen.findByRole('table', { name: 'Contas cadastradas' }),
    );
    expect(contas.getByText('Nubank Conta')).toBeTruthy();
    expect(
      within(contas.getByText('Antiga').closest('tr')!).getByText('Arquivada'),
    ).toBeTruthy();
    const cartoes = within(screen.getByRole('table', { name: 'Cartões cadastrados' }));
    const linha = cartoes.getByText('Roxinho').closest('tr')!;
    expect(within(linha).getByText('Nubank Conta')).toBeTruthy();
    expect(within(linha).getByText('1234')).toBeTruthy();
  });

  it('alternar "no patrimônio" e arquivar gravam no servidor', async () => {
    stub();
    render(
      <PreferencesProvider storage={null}>
        <AccountsCardsSection />
      </PreferencesProvider>,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('switch', { name: 'No patrimônio: Nubank Conta' }),
    );
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'PUT' && c.url.endsWith('/finance/accounts/a1')),
      ).toBe(true),
    );
    await user.click(screen.getAllByRole('button', { name: 'Arquivar' })[0]!);
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'POST' && c.url.endsWith('/finance/accounts/a1/archive'),
        ),
      ).toBe(true),
    );
  });
});
