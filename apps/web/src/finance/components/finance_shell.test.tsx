import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinanceApp } from '../finance_app.js';

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/financas/*"
          element={
            <PreferencesProvider>
              <ShortcutProvider>
                <FinanceApp />
              </ShortcutProvider>
            </PreferencesProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe('casca de Finanças', () => {
  beforeEach(() => {
    // O jsdom abre com 1024 px, e abaixo de 1240 a barra vira trilho de ícones.
    globalThis.innerWidth = 1440;
  });

  it('mostra os três grupos e Configurações no pé', () => {
    open('/financas/visao-geral');
    const nav = screen.getByRole('navigation', { name: 'Navegação de Finanças' });

    for (const group of ['Finanças', 'Contas e cartões', 'Cadastros']) {
      expect(within(nav).getByRole('heading', { name: group })).toBeVisible();
    }
    for (const item of [
      'Visão geral',
      'Lançamentos',
      'Contas',
      'Cartões',
      'Recorrentes',
      'Categorias',
      'Configurações',
    ]) {
      expect(within(nav).getByRole('button', { name: item })).toBeVisible();
    }
    expect(within(nav).getByRole('button', { name: 'Buscar' })).toHaveTextContent('⌘K');
  });

  it('destaca a tela atual e navega entre elas', async () => {
    open('/financas/lancamentos');
    const nav = screen.getByRole('navigation', { name: 'Navegação de Finanças' });
    expect(within(nav).getByRole('button', { name: 'Lançamentos' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await userEvent.click(within(nav).getByRole('button', { name: 'Categorias' }));
    expect(within(nav).getByRole('button', { name: 'Categorias' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('o extrato destaca Contas e a fatura destaca Cartões', () => {
    open('/financas/contas/itau');
    expect(screen.getByRole('button', { name: 'Contas' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('o topo mostra só o nome da área e o seletor, sem logotipo', () => {
    open('/financas/visao-geral');
    const trigger = screen.getByRole('button', { name: /Área: Finanças/ });
    expect(trigger).toHaveTextContent('Finanças');
    expect(screen.queryByText('Patrimônio')).toBeNull();
  });

  it('recolhe a barra e mantém o estado ao navegar', async () => {
    open('/financas/visao-geral');
    await userEvent.click(screen.getByRole('button', { name: 'Recolher barra lateral' }));
    await userEvent.click(screen.getByRole('button', { name: 'Contas' }));
    expect(screen.getByRole('button', { name: 'Expandir barra lateral' })).toBeVisible();
  });
});
