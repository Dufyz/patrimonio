import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { StatementScreen } from './statement_screen.js';

const open = (id = 'itau-corrente') => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter initialEntries={[`/financas/contas/${id}`]}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <Routes>
                <Route path="/financas/contas/:id" element={<StatementScreen />} />
                <Route path="/financas/contas" element={<p>Lista de contas</p>} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

const header = () =>
  within(screen.getByRole('region', { name: 'Saldo de Itaú Corrente' }));

describe('Extrato: cabeçalho de saldo (FIN-405)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('título, migalhas e subtítulo com tipo, instituição e cartão', () => {
    open();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Itaú Corrente' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Conta corrente · Itaú Unibanco · cartão Itaú Visa'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contas' })).toHaveAttribute(
      'href',
      '/financas/contas',
    );
  });

  it('painel com nome, etiqueta do papel e as ações Editar e Transferir', () => {
    open();
    const panel = header();
    expect(panel.getByRole('heading', { name: 'Itaú Corrente' })).toBeInTheDocument();
    expect(panel.getByText('recebe receitas e paga despesas')).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Transferir' })).toBeInTheDocument();
  });

  it('saldo atual em destaque e a legenda de como se formou', () => {
    open();
    const panel = header();
    expect(panel.getByLabelText('Saldo atual').textContent).toBe('R$ 3.112,80');
    expect(panel.getByText(/saldo de 01\/10/).textContent).toBe(
      'saldo de 01/10: R$ 2.133,55 · entrou R$ 16.350,00 · saiu R$ 15.370,75',
    );
  });

  it('entradas e saídas incluem transferência e fatura (Nubank)', () => {
    open('nubank-conta');
    const panel = within(screen.getByRole('region', { name: 'Saldo de Nubank Conta' }));
    expect(panel.getByText(/saldo de 01\/10/).textContent).toBe(
      'saldo de 01/10: R$ 7.766,00 · entrou R$ 4.700,00 · saiu R$ 4.045,65',
    );
    expect(panel.getByLabelText('Saldo atual').textContent).toBe('R$ 8.420,35');
  });

  it('Transferir abre o modal com a origem preenchida e atualiza o saldo', async () => {
    const user = userEvent.setup();
    open();
    await user.click(header().getByRole('button', { name: 'Transferir' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('De')).toHaveValue('itau-corrente');
    await user.selectOptions(dialog.getByLabelText('Para'), 'nubank-conta');
    await user.type(dialog.getByLabelText('Valor'), '500,00');
    await user.click(dialog.getByRole('button', { name: 'Transferir' }));
    expect(header().getByLabelText('Saldo atual').textContent).toBe('R$ 2.612,80');
  });

  it('Editar altera o nome na hora', async () => {
    const user = userEvent.setup();
    open('carteira');
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Editar conta' }));
    await user.clear(dialog.getByLabelText('Nome'));
    await user.type(dialog.getByLabelText('Nome'), 'Dinheiro');
    await user.click(dialog.getByRole('button', { name: 'Salvar' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Dinheiro' }),
    ).toBeInTheDocument();
  });

  it('benefício não oferece Transferir', () => {
    open('flex');
    expect(screen.queryByRole('button', { name: 'Transferir' })).not.toBeInTheDocument();
    expect(screen.getByText('Benefício')).toBeInTheDocument();
  });

  it('conta que não existe volta para a lista', () => {
    open('nao-existe');
    expect(screen.getByText('Lista de contas')).toBeInTheDocument();
  });
});
