import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { CardScreen } from './card_screen.js';

const inv = (month: string, status: string, total: string, extra = {}) => ({
  month,
  status,
  total,
  paid: '0',
  remaining: total,
  closing: `${month}-05`,
  due: `${month}-15`,
  overdue: false,
  from: `${month}-01`,
  to: `${month}-30`,
  payments: [],
  ...extra,
});

const body = {
  summary: {
    card: {
      id: 'c1',
      name: 'Nubank Mastercard',
      last4: '4821',
      pay_account_id: 'a1',
      limit_amount: '8000.00',
    },
    used: '2167.42',
    used_percent: 27.1,
    available: '5832.58',
  },
  as_of: '2026-11-13',
  invoices: [
    inv('2026-12', 'prevista', '300.00'),
    inv('2026-11', 'aberta', '2167.42'),
    inv('2026-10', 'paga', '900.00', {
      payments: [{ date: '2026-10-15', account_id: 'a1', amount: '900.00' }],
    }),
    inv('2026-09', 'fechada', '100.00', { overdue: true }),
  ],
  installments: [
    {
      description: 'Notebook',
      origin: '2026-08-10',
      current: 3,
      total: 10,
      amount: '500.00',
      remaining: '3500.00',
    },
  ],
  planned_payments: [
    {
      month: '2026-11',
      due: '2026-11-15',
      amount: '2167.42',
      status: 'aberta',
      account_id: 'a1',
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CardScreen · CRT-03', () => {
  it('subtítulo, faturas com pagamento e vencida, parcelamentos e pagamentos previstos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes('/accounts')
                ? { accounts: [{ account: { id: 'a1', name: 'Itaú Unibanco' } }] }
                : body,
            ),
            { status: 200 },
          ),
      ),
    );
    render(
      <MemoryRouter initialEntries={['/cartoes-novo/c1']}>
        <PreferencesProvider>
          <Routes>
            <Route path="/cartoes-novo/:id" element={<CardScreen />} />
          </Routes>
        </PreferencesProvider>
      </MemoryRouter>,
    );
    await screen.findByText(/final 4821/);
    expect(screen.getByText(/limite .*8\.000,00 · usado 27.1%/)).toBeTruthy();
    const faturas = screen.getByRole('region', { name: 'Faturas' });
    const rows = within(faturas).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent?.slice(0, 7))).toEqual([
      'dez/202',
      'nov/202',
      'out/202',
      'set/202',
    ]);
    expect(within(faturas).getByText('paga em 15/10 · Itaú Unibanco')).toBeTruthy();
    expect(within(faturas).getByText('Venceu')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Parcelamentos' })).getByText('3/10'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Pagamentos previstos' })).getByText(
        'nov/2026',
      ),
    ).toBeTruthy();
  });
});
