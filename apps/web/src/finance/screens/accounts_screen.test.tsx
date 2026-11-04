import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { AccountsScreen } from './accounts_screen.js';

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter initialEntries={['/contas']}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <Routes>
                <Route path="/contas" element={<AccountsScreen />} />
                <Route path="/financas/contas/:id" element={<p>Extrato aberto</p>} />
              </Routes>
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

describe('Contas (FIN-401)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('o subtítulo resume saldo, variação e data', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Contas' })).toBeInTheDocument();
    const subtitle = screen.getByText(/saldos de 24\/10\/2026/);
    expect(subtitle.textContent).toContain('Em contas R$ 11.773,15');
    expect(subtitle.textContent).toContain('+R$ 1.573,60 no mês');
  });

  it('colunas e seções', () => {
    open();
    for (const name of ['Conta', 'Cartão', 'Saldo', 'Variação no mês']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('entram no saldo em contas')).toBeInTheDocument();
    expect(screen.getByText('ficam fora do saldo em contas')).toBeInTheDocument();
  });

  it('Itaú Corrente: papel, cartão, saldo e variação', () => {
    open();
    const row = within(rowOf('Itaú Corrente'));
    expect(row.getByText('Recebe as receitas e paga as despesas')).toBeInTheDocument();
    expect(row.getByText('Itaú Visa')).toBeInTheDocument();
    expect(row.getByText('R$ 3.112,80')).toBeInTheDocument();
    expect(rowOf('Itaú Corrente').textContent).toContain('+R$ 979,25');
  });

  it('conta sem cartão mostra traço e variação negativa', () => {
    open();
    const row = within(rowOf('Carteira'));
    expect(row.getByText('—')).toBeInTheDocument();
    expect(row.getByText('R$ 240,00')).toBeInTheDocument();
    expect(rowOf('Carteira').textContent).toContain('−R$ 60,00');
  });

  it('Total em contas soma só as contas', () => {
    open();
    const row = within(rowOf('Total em contas'));
    expect(row.getByText('R$ 11.773,15')).toBeInTheDocument();
    expect(rowOf('Total em contas').textContent).toContain('+R$ 1.573,60');
  });

  it('benefícios mostram o crédito mensal no lugar da variação', () => {
    open();
    const vale = within(rowOf('Vale Alimentação'));
    expect(vale.getByText('R$ 612,40')).toBeInTheDocument();
    expect(vale.getByText('R$ 1.100,00')).toBeInTheDocument();
    expect(vale.getByText('todo dia 05')).toBeInTheDocument();
    const flex = within(rowOf('Flex'));
    expect(flex.getByText('R$ 198,30')).toBeInTheDocument();
    expect(flex.getByText('R$ 400,00')).toBeInTheDocument();
  });

  it('clicar na linha abre o Extrato', async () => {
    open();
    await userEvent.click(screen.getByText('Nubank Conta'));
    expect(screen.getByText('Extrato aberto')).toBeInTheDocument();
  });

  it('o menu ⋯ lista Editar, Transferir e Arquivar', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Carteira' }));
    expect(screen.getByRole('menuitem', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Transferir' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Arquivar' })).toBeInTheDocument();
    expect(screen.queryByText('Extrato aberto')).not.toBeInTheDocument();
  });
});
