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
  payments: [{ id: 'p1', date: '2026-11-10', account_id: 'a1', amount: '550.05' }],
  months: ['2026-10', '2026-11'],
  unpaid_months: ['2026-10', '2026-11'],
};

const calls: { url: string; method: string; body?: string }[] = [];

const mount = (status = 'aberta'): void => {
  calls.length = 0;
  const current = { ...body, summary: { ...body.summary, status } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      });
      const payload = url.includes('/categories')
        ? { categories: [{ id: 'c1', name: 'Alimentação', kind: 'despesa' }] }
        : url.includes('/finance/accounts')
          ? { accounts: [{ account: { id: 'a1', name: 'Itaú Unibanco' } }] }
          : current;
      return new Response(JSON.stringify(payload), { status: 200 });
    }),
  );
  render(
    <MemoryRouter initialEntries={['/cartoes/c1/faturas/2026-11']}>
      <PreferencesProvider>
        <Routes>
          <Route path="/cartoes/:id/faturas/:month" element={<InvoiceScreen />} />
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

describe('InvoiceScreen · CRT-07', () => {
  it('fatura paga é somente leitura: sem crédito, encargo nem ações de linha', async () => {
    mount('paga');
    await screen.findByText('Mercado');
    expect(screen.queryByRole('button', { name: 'Novo crédito' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Novo encargo' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ações de Mercado/ })).toBeNull();
  });

  it('encargo exige categoria e depois grava na fatura exibida', async () => {
    mount();
    await screen.findByText('Mercado');
    fireEvent.click(screen.getByRole('button', { name: 'Novo encargo' }));
    fireEvent.change(await screen.findByLabelText('Descrição'), {
      target: { value: 'Juros rotativos' },
    });
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '12,50' } });
    fireEvent.click(screen.getByRole('button', { name: /Lançar encargo/ }));
    expect(
      await screen.findByText('Encargo precisa de uma categoria de despesa.'),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: /Lançar encargo/ }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/finance/cards/c1/items');
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
      kind: 'encargo',
      subtype: 'juros',
      invoice_month: '2026-11',
      amount: '12.50',
      category_id: 'c1',
    });
  });
});

describe('InvoiceScreen · CRT-06', () => {
  it('excluir o pagamento pede confirmação e chama a api', async () => {
    mount('paga');
    await screen.findByText('Mercado');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir pagamento' }));
    const buttons = await screen.findAllByRole('button', { name: 'Excluir pagamento' });
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe(
      '/api/finance/payments/p1',
    );
  });
});
