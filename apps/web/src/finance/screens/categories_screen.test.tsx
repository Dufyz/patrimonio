import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { CategoriesScreen } from './categories_screen.js';

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter>
      <PreferencesProvider>
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

const rowOf = (name: string) => {
  const row = screen.getByText(name).closest('tr');
  if (row === null) throw new Error(`sem linha para ${name}`);
  return row;
};

describe('Categorias (FIN-101)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('mostra título, subtítulo e o contador', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Categorias' })).toBeInTheDocument();
    expect(screen.getByText('Nome, tipo e cor de cada categoria')).toBeInTheDocument();
    expect(screen.getByText('15 categorias')).toBeInTheDocument();
  });

  it('rotula as colunas com o mês corrente', () => {
    open();
    expect(
      screen.getByRole('columnheader', { name: 'Lançamentos em out' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Total em out' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Média de 12 meses' }),
    ).toBeInTheDocument();
  });

  it('separa Despesas e Receitas', () => {
    open();
    expect(screen.getByText('Despesas')).toBeInTheDocument();
    expect(screen.getByText('Receitas')).toBeInTheDocument();
  });

  it('categoria sem lançamento no mês mostra 0 e —', () => {
    open();
    const row = rowOf('Mercado');
    expect(within(row).getByText('0')).toBeInTheDocument();
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).getByText(/1\.482,35/)).toBeInTheDocument();
  });

  it('Investimento e Gasto livre aparecem como as demais', () => {
    open();
    expect(within(rowOf('Investimento')).getByText(/4\.500,00/)).toBeInTheDocument();
    expect(rowOf('Gasto livre')).toBeInTheDocument();
  });

  it('a busca filtra enquanto digita', async () => {
    open();
    await userEvent.type(screen.getByRole('searchbox'), 'saude');
    expect(screen.getByText('1 categoria')).toBeInTheDocument();
    expect(screen.queryByText('Moradia')).not.toBeInTheDocument();
  });

  it('o filtro de tipo deixa só as receitas', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Receita' }));
    expect(screen.getByText('3 categorias')).toBeInTheDocument();
    expect(screen.queryByText('Despesas')).not.toBeInTheDocument();
  });

  it('Exibição oculta a média e a escolha persiste', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Exibição' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Média de 12 meses' }));
    expect(
      screen.queryByRole('columnheader', { name: 'Média de 12 meses' }),
    ).not.toBeInTheDocument();
    expect(
      globalThis.localStorage.getItem('patrimonio.finance.columns.categorias'),
    ).toContain('media');
  });
});
