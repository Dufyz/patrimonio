import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { CardsScreen } from './cards_screen.js';

const card = (
  id: string,
  name: string,
  pay: string,
  abertas: string,
  fechadas: string,
) => ({
  card: {
    id,
    name,
    last4: '4821',
    pay_account_id: pay,
    limit_amount: '8000.00',
    closing_day: 5,
    due_day: 15,
  },
  invoice: {
    month: '2026-11',
    status: 'aberta',
    total: abertas,
    remaining: abertas,
    due: '2026-11-20',
    overdue: false,
  },
  used: abertas,
  used_percent: 27.1,
  available: '5832.58',
  days_to_due: 7,
  debt: { abertas, fechadas_a_pagar: fechadas, next_due: '2026-11-20' },
});

const body = {
  cards: [
    card('c1', 'Itaú Visa', 'a1', '1000.00', '2100.95'),
    card('c2', 'Nubank', 'a1', '1167.42', '0.00'),
  ],
  upcoming: [
    {
      month: '2026-11',
      status: 'aberta',
      cells: [
        { card_id: 'c1', amount: '3100.95' },
        { card_id: 'c2', amount: null },
      ],
      total: '3100.95',
    },
  ],
  open_total: '2167.42',
  as_of: '2026-11-13',
  wealth: {
    em_contas: '1462.51',
    abertas: '2167.42',
    fechadas_a_pagar: '2100.95',
    total_devido: '4268.37',
    livre: '0.00',
    falta: '2805.86',
  },
};

const mount = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const payload = url.includes('/accounts')
        ? { accounts: [{ account: { id: 'a1', name: 'Itaú Unibanco' } }] }
        : url.includes('/categories') || url.includes('institutions')
          ? { categories: [], institutions: [] }
          : body;
      return new Response(JSON.stringify(payload), { status: 200 });
    }),
  );
  render(
    <MemoryRouter>
      <PreferencesProvider>
        <CardsScreen />
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CardsScreen · CRT-01/02', () => {
  it('seção por conta pagadora, total devido e Livre após faturas com "faltam"', async () => {
    mount();
    expect(await screen.findByText('Itaú Unibanco paga 2 cartões')).toBeTruthy();
    expect(screen.getAllByText(/4\.268,37/).length).toBeGreaterThan(0);
    expect(screen.getByText(/faltam .*2\.805,86/)).toBeTruthy();
    expect(screen.getByText(/próximo vencimento 20\/11/)).toBeTruthy();
  });

  it('próximas faturas usam traço para cartão sem fatura a pagar', async () => {
    mount();
    const panel = await screen.findByRole('region', { name: 'Próximas faturas' });
    expect(within(panel).getByText('nov/2026')).toBeTruthy();
    expect(within(panel).getAllByText('—').length).toBe(1);
  });

  it('Pagar fatura abre o modal sem navegar', async () => {
    mount();
    await screen.findByText('Itaú Unibanco paga 2 cartões');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Pagar fatura' })[0] as HTMLElement,
    );
    expect(await screen.findByText('Novo lançamento')).toBeTruthy();
  });
});
