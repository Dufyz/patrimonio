import { chooseFilter } from '../lib/test_helpers.js';
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
    expect(
      screen.getByText('Nome e cor das categorias de despesa e receita'),
    ).toBeInTheDocument();
    expect(screen.getByText('15 categorias')).toBeInTheDocument();
  });

  it('é só cadastro: sem tipo, lançamentos, total ou média', () => {
    open();
    expect(screen.getByRole('columnheader', { name: 'Categoria' })).toBeInTheDocument();
    for (const name of [/Tipo/, /Lançamentos/, /Total/, /Média/]) {
      expect(screen.queryByRole('columnheader', { name })).not.toBeInTheDocument();
    }
  });

  it('separa Despesas e Receitas', () => {
    open();
    expect(screen.getByText('Despesas')).toBeInTheDocument();
    expect(screen.getByText('Receitas')).toBeInTheDocument();
  });

  it('Investimento e Gasto livre aparecem como as demais', () => {
    open();
    expect(rowOf('Investimento')).toBeInTheDocument();
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
    await chooseFilter('Tipo', 'Receita');
    expect(screen.getByText('3 categorias')).toBeInTheDocument();
    expect(screen.queryByText('Despesas')).not.toBeInTheDocument();
  });

  it('cria uma categoria pelo modal', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Categoria/ }));
    const dialog = screen.getByRole('dialog', { name: 'Nova categoria' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nome' }), 'Pets');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Verde' }));
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }),
    );
    expect(screen.getByText('Pets')).toBeInTheDocument();
    expect(screen.getByText('16 categorias')).toBeInTheDocument();
  });

  it('mostra o erro de nome repetido só ao salvar', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Categoria/ }));
    const dialog = screen.getByRole('dialog', { name: 'Nova categoria' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Nome' }),
      'Moradia',
    );
    expect(within(dialog).queryByText(/Já existe/)).not.toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }),
    );
    expect(within(dialog).getByText(/Já existe/)).toBeInTheDocument();
  });

  it('edita pelo menu da linha e trava o tipo de categoria em uso', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Moradia' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar categoria' });
    expect(within(dialog).getByRole('combobox', { name: 'Tipo' })).toBeDisabled();
    const name = within(dialog).getByRole('textbox', { name: 'Nome' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Casa');
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }),
    );
    expect(screen.getByText('Casa')).toBeInTheDocument();
    expect(screen.queryByText('Moradia')).not.toBeInTheDocument();
  });

  it('exclui categoria em uso só depois de escolher o destino', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Transporte' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog', { name: 'Excluir categoria' });
    const confirm = within(dialog).getByRole('button', { name: 'Excluir' });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Mover para' }),
      'Saúde',
    );
    await userEvent.click(confirm);
    expect(screen.queryByText('Transporte')).not.toBeInTheDocument();
    expect(rowOf('Saúde')).toBeInTheDocument();
  });

  it('exclui categoria sem lançamentos com uma confirmação', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Categoria/ }));
    const form = screen.getByRole('dialog', { name: 'Nova categoria' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Nome' }), 'Pets');
    await userEvent.click(
      within(form).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Pets' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog', { name: 'Excluir categoria' });
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    expect(screen.queryByText('Pets')).not.toBeInTheDocument();
  });
});
