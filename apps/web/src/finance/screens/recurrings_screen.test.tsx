import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { RecurringsScreen } from './recurrings_screen.js';

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <RecurringsScreen />
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

describe('Recorrentes (FIN-201)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('mostra título, subtítulo e o resumo de ativas e pausadas', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Recorrentes' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Receitas e despesas que se repetem e geram os previstos de Lançamentos todo dia 1',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('15 ativas · 1 pausada')).toBeInTheDocument();
  });

  it('tem as colunas do documento', () => {
    open();
    for (const name of [
      'Item',
      'Categoria',
      'Pagamento',
      'Dia',
      'Lançamento',
      'Valor',
      'Ativo',
    ]) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    }
  });

  it('Receitas antes de Despesas, e cada seção pelo dia do mês', () => {
    open();
    const names = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    const at = (text: string) => names.findIndex((line) => line.includes(text));
    expect(at('Receitas')).toBeLessThan(at('Despesas'));
    expect(at('Salário')).toBeLessThan(at('Freela'));
    expect(at('Freela')).toBeLessThan(at('Reembolso da empresa'));
    expect(at('Plano de saúde')).toBeLessThan(at('Aluguel e condomínio'));
    expect(at('Aluguel e condomínio')).toBeLessThan(at('Seguro do carro'));
  });

  it('valor manual traz "estimativa"; automático não', () => {
    open();
    expect(within(rowOf('Conta de luz')).getByText('estimativa')).toBeInTheDocument();
    expect(within(rowOf('Netflix')).queryByText('estimativa')).not.toBeInTheDocument();
  });

  it('pagamento com duas origens mostra as duas e a nota', () => {
    open();
    const row = rowOf('Conta de luz');
    expect(within(row).getByText(/Flex \+ Itaú Corrente/)).toBeInTheDocument();
    expect(within(row).getByText('Flex cobre até R$ 150,00')).toBeInTheDocument();
  });

  it('linha pausada fica esmaecida e o interruptor mostra desligado', () => {
    open();
    const row = rowOf('Seguro residencial');
    expect(row.className).toContain('opacity');
    expect(within(row).getByRole('switch')).not.toBeChecked();
    expect(within(rowOf('Netflix')).getByRole('switch')).toBeChecked();
  });

  it('filtra por situação', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pausado' }));
    expect(screen.getByText('0 ativas · 1 pausada')).toBeInTheDocument();
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
  });

  it('a busca acha por pagamento', async () => {
    open();
    await userEvent.type(screen.getByRole('searchbox'), 'nubank');
    expect(screen.getByText('1 ativa')).toBeInTheDocument();
    expect(screen.getAllByText('Gasto livre').length).toBeGreaterThan(0);
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
  });

  it('o interruptor liga e desliga na hora e atualiza o resumo', async () => {
    open();
    await userEvent.click(within(rowOf('Spotify')).getByRole('switch'));
    expect(screen.getByText('14 ativas · 2 pausadas')).toBeInTheDocument();
    expect(within(rowOf('Spotify')).getByRole('switch')).not.toBeChecked();
    await userEvent.click(within(rowOf('Spotify')).getByRole('switch'));
    expect(screen.getByText('15 ativas · 1 pausada')).toBeInTheDocument();
  });
});

describe('Novo recorrente, edição e exclusão (FIN-202)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('cria um recorrente pelo modal', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Recorrente/ }));
    const dialog = screen.getByRole('dialog', { name: 'Novo recorrente' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Item' }),
      'Pilates',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Categoria' }),
      'Saúde',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Pagamento' }),
      'Itaú Visa',
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Dia do mês' }),
      '8',
    );
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Valor' }), '24000');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }));
    expect(screen.getByText('Pilates')).toBeInTheDocument();
    expect(screen.getByText('16 ativas · 1 pausada')).toBeInTheDocument();
  });

  it('mostra os erros só depois de tentar salvar', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Recorrente/ }));
    const dialog = screen.getByRole('dialog', { name: 'Novo recorrente' });
    expect(within(dialog).queryByText(/Dê um nome/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }));
    expect(within(dialog).getByText(/Dê um nome/)).toBeInTheDocument();
    expect(within(dialog).getByText(/dia de 1 a 31/)).toBeInTheDocument();
  });

  it('o valor manual vira "estimado" e as duas origens pedem o limite', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Recorrente/ }));
    const dialog = screen.getByRole('dialog', { name: 'Novo recorrente' });
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Lançamento' }),
      'Manual',
    );
    expect(within(dialog).getByText('Valor estimado')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Dividir/ }));
    expect(within(dialog).getByText('Primeira origem cobre até')).toBeInTheDocument();
    expect(within(dialog).getByText('Segunda origem')).toBeInTheDocument();
  });

  it('edita pelo menu da linha', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Internet' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar recorrente' });
    const day = within(dialog).getByRole('textbox', { name: 'Dia do mês' });
    expect(day).toHaveValue('15');
    await userEvent.clear(day);
    await userEvent.type(day, '3');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Salvar(?:\s*⌘↵)?$/ }));
    expect(within(rowOf('Internet')).getByText('03')).toBeInTheDocument();
  });

  it('exclui com confirmação', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Netflix' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog', { name: 'Excluir recorrente' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
    expect(screen.getByText('14 ativas · 1 pausada')).toBeInTheDocument();
  });
});
