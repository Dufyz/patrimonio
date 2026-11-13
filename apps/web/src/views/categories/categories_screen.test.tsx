import axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../../finance/components/period_provider.js';
import { setTodayOverride } from '../../finance/lib/clock.js';
import {
  createFinanceStore,
  FinanceStoreProvider,
} from '../../finance/store/finance_store.js';
import { CategoriesScreen } from './categories_screen.js';

const cats = [
  {
    id: 'm',
    name: 'Mercado',
    kind: 'despesa',
    color: 'green',
    nature: 'livre',
    archived: false,
  },
  {
    id: 'a',
    name: 'Aluguel',
    kind: 'despesa',
    color: 'blue',
    nature: 'fixa',
    archived: false,
  },
  {
    id: 'z',
    name: 'Zerada',
    kind: 'despesa',
    color: 'gray',
    nature: 'livre',
    archived: false,
  },
  {
    id: 's',
    name: 'Salário',
    kind: 'receita',
    color: 'violet',
    nature: null,
    archived: false,
  },
];

const usage = {
  range: { from: '2026-10-01', to: '2026-10-31' },
  rows: [
    { category_id: 'm', posted: '300.00', planned: '0.00', entries_total: 3 },
    { category_id: 'a', posted: '1200.00', planned: '50.00', entries_total: 1 },
    { category_id: 'z', posted: '0.00', planned: '0.00', entries_total: 0 },
    { category_id: 's', posted: '8000.00', planned: '0.00', entries_total: 2 },
  ],
  totals: {
    receita: { posted: '8000.00', planned: '0.00' },
    despesa: { posted: '1500.00', planned: '50.00' },
  },
};

const calls: { url: string; method: string; body: string | null }[] = [];

const stub = (): void => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/categories/usage')) return json(usage);
      if (url.endsWith('/finance/categories')) return json({ categories: cats });
      return json({});
    }),
  );
};

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter>
      <PreferencesProvider storage={null}>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <CategoriesScreen />
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

afterEach(() => vi.unstubAllGlobals());

describe('Categorias (CAT-01/02/03)', () => {
  it('seções Despesas e Receitas, com lançado, previsto, zero e traço, e total por seção', async () => {
    stub();
    open();
    const despesas = await screen.findByRole('rowgroup', { name: 'Despesas' });
    expect(within(despesas).getByText('Natureza')).toBeTruthy();
    const zerada = within(despesas).getByRole('row', { name: 'Zerada' });
    expect(zerada.textContent).toContain('0');
    expect(zerada.textContent).toContain('—');
    const total = within(despesas)
      .getByText(/Total · Despesas/)
      .closest('tr');
    expect(total?.textContent).toContain('R$ 1.500,00');
    expect(total?.textContent).toContain('R$ 50,00');
    const receitas = screen.getByRole('rowgroup', { name: 'Receitas' });
    expect(within(receitas).queryByText('Natureza')).toBeNull();
    expect(screen.getByText('4 categorias')).toBeTruthy();
  });

  it('a categoria leva a Lançamentos filtrado por ela', async () => {
    stub();
    open();
    const link = await screen.findByRole('link', { name: 'Mercado' });
    expect(link.getAttribute('href')).toBe('/lancamentos?categoria=m&tipo=DESPESA');
  });

  it('busca filtra e limpar filtros devolve a lista', async () => {
    stub();
    open();
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('searchbox', { name: 'Buscar categoria' }),
      'zzzz',
    );
    await user.click(await screen.findByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByText('4 categorias')).toBeTruthy();
  });

  it('excluir categoria em uso pede o destino e confirma em dois passos, numa só chamada', async () => {
    stub();
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ações de Mercado' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/tem 3 lançamentos/)).toBeTruthy();
    await user.selectOptions(dialog.getByLabelText('Mover para'), 'a');
    await user.click(dialog.getByRole('button', { name: /Continuar/ }));
    const confirm = within(await screen.findByRole('dialog'));
    expect(confirm.getByText(/3 lançamentos de "Mercado"/)).toBeTruthy();
    await user.click(confirm.getByRole('button', { name: 'Excluir e mover' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.url.endsWith('/finance/categories/m/delete') &&
            c.body === JSON.stringify({ move_to: 'a' }),
        ),
      ).toBe(true),
    );
  });

  it('categoria sem uso é excluída direto, com confirmação simples', async () => {
    stub();
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ações de Zerada' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Excluir',
      }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'DELETE' && c.url.endsWith('/finance/categories/z'),
        ),
      ).toBe(true),
    );
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

describe('CAT-07 · acessibilidade de Categorias nos dois temas', () => {
  it.each(['light', 'dark'])('sem violação AA (tema %s)', async (theme) => {
    document.documentElement.dataset['theme'] = theme;
    stub();
    const { container } = open();
    await screen.findByRole('rowgroup', { name: 'Despesas' });
    expect(await aaViolations(container)).toEqual([]);
  });
});
