import axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { RecurringsScreen } from './recurrings_screen.js';

const recurring = (over: Record<string, unknown>) => ({
  id: 'r',
  name: 'Item',
  kind: 'despesa',
  category_id: 'c1',
  portfolio_id: null,
  asset_id: null,
  source: { type: 'conta', id: 'a1' },
  second_source: null,
  covers_up_to: null,
  day: 5,
  mode: 'manual',
  amount: '100.00',
  active: true,
  version: 1,
  ...over,
});

const recurrings = [
  recurring({
    id: 'r1',
    name: 'Salário',
    kind: 'receita',
    category_id: 'c2',
    amount: '8000.00',
  }),
  recurring({ id: 'r2', name: 'Aluguel', amount: '1200.00', mode: 'automatico' }),
  recurring({ id: 'r3', name: 'Academia', amount: '100.00', active: false }),
  recurring({
    id: 'r4',
    name: 'Aporte mensal',
    kind: 'aporte',
    category_id: null,
    portfolio_id: 'p1',
    amount: '2000.00',
  }),
];

const calls: { url: string; method: string }[] = [];

const stub = (): void => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith('/finance/recurrings')) return json({ recurrings });
      if (url.endsWith('/finance/categories'))
        return json({
          categories: [
            {
              id: 'c1',
              name: 'Moradia',
              kind: 'despesa',
              color: 'blue',
              archived: false,
            },
            {
              id: 'c2',
              name: 'Salário',
              kind: 'receita',
              color: 'green',
              archived: false,
            },
          ],
        });
      if (url.includes('/finance/accounts'))
        return json({
          accounts: [{ account: { id: 'a1', name: 'Nubank Conta', archived: false } }],
          total_balance: '0.00',
          projected_total: '0.00',
          as_of: '2026-11-11',
        });
      if (url.endsWith('/finance/cards')) return json({ cards: [] });
      return json({});
    }),
  );
};

const open = () =>
  render(
    <MemoryRouter>
      <PreferencesProvider storage={null}>
        <ShortcutProvider>
          <RecurringsScreen />
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('Recorrentes (REC-01/02/03/05)', () => {
  it('mostra os blocos por tipo, o resumo de ativas e o resultado mensal com aportes', async () => {
    stub();
    open();
    const tabela = await screen.findByRole('table', { name: 'Recorrentes' });
    expect(screen.getByText('3 ativas · 1 pausada')).toBeTruthy();
    for (const bloco of ['Receitas', 'Despesas', 'Aportes']) {
      expect(within(tabela).getByText(bloco)).toBeTruthy();
    }
    // 8.000 − 1.200 − 2.000 (a pausada não entra)
    const resultado = within(tabela)
      .getByText(/Resultado mensal/)
      .closest('tr');
    expect(resultado?.textContent).toContain('R$ 4.800,00');
    expect(within(tabela).getAllByText('100,0%').length).toBeGreaterThan(0);
  });

  it('o interruptor Ativo grava no servidor', async () => {
    stub();
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('switch', { name: 'Ativo: Academia' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'POST' && c.url.endsWith('/finance/recurrings/r3/active'),
        ),
      ).toBe(true),
    );
  });

  it('filtro sem resultado oferece Limpar filtros', async () => {
    stub();
    open();
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('searchbox', { name: 'Buscar recorrente' }),
      'zzz',
    );
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByRole('table', { name: 'Recorrentes' })).toBeTruthy();
  });

  it('o aporte no modal pede carteira, não pede categoria e é sempre manual', async () => {
    stub();
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Novo recorrente/ }));
    const modal = within(await screen.findByRole('dialog'));
    await user.selectOptions(modal.getByLabelText('Tipo'), 'aporte');
    expect(modal.getByLabelText('Carteira')).toBeTruthy();
    expect(modal.queryByLabelText('Categoria')).toBeNull();
    expect((modal.getByLabelText('Lançamento') as HTMLSelectElement).disabled).toBe(true);
  });
});

const aaViolations = async (container: HTMLElement): Promise<readonly string[]> => {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
};

describe('REC-07 · acessibilidade de Recorrentes nos dois temas', () => {
  it.each(['light', 'dark'])('sem violação AA (tema %s)', async (theme) => {
    document.documentElement.dataset['theme'] = theme;
    stub();
    const { container } = open();
    await screen.findByRole('table', { name: 'Recorrentes' });
    expect(await aaViolations(container)).toEqual([]);
  });
});
