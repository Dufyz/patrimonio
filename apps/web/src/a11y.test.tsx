/**
 * QUA-03 · Verificação automatizada de acessibilidade (axe-core) em telas
 * representativas. jsdom não calcula cor nem layout, então a regra de contraste
 * fica de fora aqui (ela é coberta por `lib/contrast.test.ts`, que mede os
 * tokens dos dois temas).
 */
import { render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from './components/preferences.js';
import { AccountsScreen } from './views/accounts/accounts_screen.js';
import { LedgerScreen } from './views/ledger/ledger_screen.js';

const violations = async (container: HTMLElement): Promise<readonly string[]> => {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
};

const account = {
  account: {
    id: 'a1',
    name: 'Nubank Conta',
    type: 'corrente',
    institution: 'Banco',
    role: 'Papel',
    in_wealth: true,
    archived: false,
  },
  balance: '1022.86',
  variation: '0',
  cards: [],
  projected_month_end: '200.00',
};
const accounts = {
  accounts: [account],
  total_balance: '1022.86',
  projected_total: '200.00',
  as_of: '2026-11-11',
};
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
      account_id: 'a1',
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
  ],
  next_cursor: null,
  totals: {
    receitas: '5000',
    despesas: '0',
    aportes: '0',
    saldo_do_mes: '5000',
    previsto: zero,
    a_lancar: 0,
  },
  count: 1,
  groups: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('QUA-03 · axe nas telas', () => {
  it.each(['light', 'dark'])('Contas não tem violação AA (tema %s)', async (theme) => {
    document.documentElement.dataset['theme'] = theme;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(accounts), { status: 200 })),
    );
    const { container } = render(
      <MemoryRouter>
        <PreferencesProvider>
          <AccountsScreen />
        </PreferencesProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Nubank Conta')).toBeTruthy());
    expect(await violations(container)).toEqual([]);
  });

  it.each(['light', 'dark'])(
    'Lançamentos não tem violação AA (tema %s)',
    async (theme) => {
      document.documentElement.dataset['theme'] = theme;
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async (url: string) =>
            new Response(
              JSON.stringify(String(url).includes('/accounts') ? accounts : book),
              {
                status: 200,
              },
            ),
        ),
      );
      const { container } = render(
        <MemoryRouter initialEntries={['/lancamentos']}>
          <PreferencesProvider>
            <LedgerScreen />
          </PreferencesProvider>
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByText('Salário')).toBeTruthy());
      expect(await violations(container)).toEqual([]);
    },
  );
});

describe('QUA-03 · o detector funciona', () => {
  it('acusa imagem sem texto alternativo', async () => {
    const { container } = render(<img src="x.png" />);
    expect((await violations(container)).join()).toContain('image-alt');
  });
});
