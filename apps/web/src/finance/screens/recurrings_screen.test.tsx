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
});
