import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { AccountsScreen } from './accounts_screen.js';

const row = (id: string, name: string, balance: string, archived = false) => ({
  account: {
    id,
    name,
    type: 'corrente',
    institution: 'Itaú',
    role: '',
    opening_amount: '0.00',
    opening_date: '2026-01-01',
    in_wealth: true,
    archived,
  },
  balance,
  variation: '0',
  cards: [],
  projected_month_end: balance,
});

const calls: { url: string; method: string; body: string | undefined }[] = [];

const mount = (rows: ReturnType<typeof row>[]): void => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
      });
      const body = url.includes('/categories')
        ? { categories: [] }
        : url.includes('/cards') || url.includes('institutions')
          ? { cards: [], institutions: [] }
          : {
              accounts: rows,
              total_balance: '0',
              projected_total: '0',
              as_of: '2026-11-13',
            };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  render(
    <MemoryRouter>
      <PreferencesProvider>
        <AccountsScreen />
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Contas · CTA-05/06', () => {
  it('Nova conta: valida nome único e envia com no patrimônio ligado', async () => {
    mount([row('a1', 'Itaú', '10.00')]);
    await screen.findByText('Itaú', { selector: 'th' });
    fireEvent.click(screen.getByRole('button', { name: /Nova conta/ }));
    fireEvent.change(await screen.findByLabelText('Nome'), { target: { value: 'itaú' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar conta/ }));
    expect(await screen.findByText('Já existe uma conta com esse nome.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Nubank' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar conta/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/finance/accounts');
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
      name: 'Nubank',
      in_wealth: true,
    });
  });

  it('Arquivar com saldo exige confirmação explícita', async () => {
    mount([row('a1', 'Itaú', '10.00')]);
    await screen.findByText('Itaú', { selector: 'th' });
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    const confirm = await screen.findByRole('button', {
      name: 'Arquivar',
      hidden: false,
    });
    expect(screen.getByText(/Saldo atual/)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Arquivar' });
    const last = buttons[buttons.length - 1] as HTMLButtonElement;
    expect(last.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Arquivar mesmo com saldo'));
    expect(last.disabled).toBe(false);
    void confirm;
  });
});

describe('Contas · CTA-07/08', () => {
  it('vazio oferece Nova conta', async () => {
    mount([]);
    expect(
      await screen.findByText('Você ainda não cadastrou nenhuma conta.'),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Nova conta/ }).length).toBeGreaterThan(
      1,
    );
  });

  it('setas percorrem as linhas', async () => {
    mount([row('a1', 'Itaú', '10.00'), row('a2', 'Nubank', '5.00')]);
    await screen.findByText('Nubank', { selector: 'th' });
    const rows = screen.getAllByRole('row').filter((r) => r.tabIndex === 0);
    rows[0]?.focus();
    fireEvent.keyDown(rows[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
  });
});
