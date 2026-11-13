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

describe('CardsScreen · CRT-08', () => {
  it('Novo cartão valida e envia o pedido', async () => {
    mount();
    await screen.findByText('Itaú Unibanco paga 2 cartões');
    fireEvent.click(screen.getByRole('button', { name: /Novo cartão/ }));
    fireEvent.change(await screen.findByLabelText('Nome'), {
      target: { value: 'nubank' },
    });
    fireEvent.change(screen.getByLabelText('Limite'), { target: { value: '5.000,00' } });
    fireEvent.change(screen.getByLabelText('Dia de fechamento'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Criar cartão/ }));
    expect(await screen.findByText('Já existe um cartão com esse nome.')).toBeTruthy();
    expect(screen.getAllByText('Dia de 1 a 31.')).toHaveLength(2);
  });
});

describe('CardsScreen · CRT-10/11', () => {
  it('pagar fatura já paga mostra o erro e recarrega a lista', async () => {
    let cardsCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST')
          return new Response(
            JSON.stringify({ code: 'INVOICE_ALREADY_PAID', message: 'Fatura já paga.' }),
            { status: 409 },
          );
        if (url.endsWith('/api/finance/cards')) cardsCalls += 1;
        const payload = url.includes('/accounts')
          ? { accounts: [{ account: { id: 'a1', name: 'Itaú Unibanco' } }] }
          : url.includes('/categories') || url.includes('institutions')
            ? { categories: [], institutions: [] }
            : url.includes('/cards/')
              ? { cards: [] }
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
    await screen.findByText('Itaú Unibanco paga 2 cartões');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Pagar fatura' })[0] as HTMLElement,
    );
    await screen.findByText('Novo lançamento');
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '10,00' } });
    fireEvent.click(screen.getByRole('button', { name: /Lançar/ }));
    await vi.waitFor(() => expect(cardsCalls).toBeGreaterThan(1));
  });
});
