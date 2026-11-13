import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { InvoiceScreen } from './invoice_screen.js';

const line = (
  id: string,
  block: string,
  description: string,
  amount: string,
  extra = {},
) => ({
  id,
  origin: 'entry',
  block,
  date: '2026-11-02',
  description,
  category_id: 'c1',
  amount,
  installment: null,
  subtype: null,
  forecast: false,
  ...extra,
});

const body = {
  card: { id: 'c1', name: 'Nubank', last4: '4821', pay_account_id: 'a1' },
  summary: {
    month: '2026-11',
    status: 'aberta',
    total: '550.05',
    paid: '0',
    remaining: '550.05',
    closing: '2026-11-05',
    due: '2026-11-15',
    overdue: false,
  },
  period: { from: '2026-10-06', to: '2026-11-05' },
  lines: [
    line('l1', 'compras', 'Mercado', '100.10'),
    line('l2', 'parcelas', 'Notebook', '500.00', { installment: { no: 3, total: 10 } }),
    line('l3', 'creditos', 'Estorno', '50.05'),
  ],
  totals: {
    compras: '100.10',
    parcelas: '500.00',
    creditos: '50.05',
    encargos: '0.00',
    total: '550.05',
  },
  payments: [],
  months: ['2026-10', '2026-11'],
};

const mount = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const payload = url.includes('/categories')
        ? { categories: [{ id: 'c1', name: 'Alimentação', kind: 'despesa' }] }
        : url.includes('/finance/accounts')
          ? { accounts: [{ account: { id: 'a1', name: 'Itaú Unibanco' } }] }
          : body;
      return new Response(JSON.stringify(payload), { status: 200 });
    }),
  );
  render(
    <MemoryRouter initialEntries={['/cartoes-novo/c1/faturas/2026-11']}>
      <PreferencesProvider>
        <Routes>
          <Route path="/cartoes-novo/:id/faturas/:month" element={<InvoiceScreen />} />
        </Routes>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InvoiceScreen · CRT-04/05', () => {
  it('resumo, blocos na ordem, bloco vazio e total da fatura', async () => {
    mount();
    await screen.findByText('Mercado');
    expect(
      screen.getByText(
        /compras de 06\/10 a 05\/11 · fecha em 05\/11 · vence em 15\/11 · paga com Itaú Unibanco/,
      ),
    ).toBeTruthy();
    const groups = screen
      .getAllByRole('rowheader')
      .filter(
        (h) =>
          h.getAttribute('scope') === 'rowgroup' ||
          /Compras do período|Parcelas|Créditos|Encargos/.test(h.textContent ?? ''),
      );
    expect(groups.map((g) => g.textContent)).toEqual([
      'Compras do período',
      'Parcelas de compras anteriores',
      'Créditos e ajustes',
      'Encargos',
    ]);
    expect(screen.getByText('nenhum nesta fatura')).toBeTruthy();
    expect(screen.getByText('Total da fatura').closest('tr')?.textContent).toContain(
      '550,05',
    );
  });

  it('busca e filtro não mexem no total; mostram subtotal filtrado', async () => {
    mount();
    await screen.findByText('Mercado');
    fireEvent.change(screen.getByLabelText('Buscar na fatura'), {
      target: { value: 'mercado' },
    });
    expect(screen.queryByText('Notebook')).toBeNull();
    expect(screen.getByText('Total da fatura').closest('tr')?.textContent).toContain(
      '550,05',
    );
    const sub = screen.getByText('Subtotal filtrado').closest('tr') as HTMLElement;
    expect(within(sub).getByText(/100,10/)).toBeTruthy();
  });

  it('navegador de mês para na última prevista', async () => {
    mount();
    await screen.findByText('Mercado');
    expect((screen.getByLabelText('Próxima fatura') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText('Fatura anterior') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
