import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { FinanceSearch } from './finance_search.js';
import { FinancePeriodProvider } from './period_provider.js';

const Where = (): React.ReactElement => {
  const location = useLocation();
  return <p>{`${location.pathname}${location.search}`}</p>;
};

const open = () => {
  setTodayOverride('2026-10-24');
  let closed = 0;
  render(
    <MemoryRouter initialEntries={['/financas/visao-geral']}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <FinanceSearch open onClose={() => (closed += 1)} />
              <Routes>
                <Route path="*" element={<Where />} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
  return { closed: () => closed };
};

describe('busca global (FIN-703)', () => {
  it('resultados agrupados enquanto digita', async () => {
    open();
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar' }), 'itaú');
    expect(screen.getByRole('group', { name: 'Contas' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Cartões' })).toBeTruthy();
  });

  it('setas e Enter abrem o resultado, com o teclado só', async () => {
    const probe = open();
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar' }), 'itaú');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByText('/financas/cartoes/itau-visa')).toBeTruthy();
    expect(probe.closed()).toBe(1);
  });

  it('o lançamento abre Lançamentos com a busca aplicada', async () => {
    open();
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar' }), 'netflix');
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Lançamentos' })).getByRole('option', {
        name: /Netflix/,
      }),
    );
    expect(screen.getByText('/financas/lancamentos?busca=Netflix')).toBeTruthy();
  });

  it('sem resultado diz o que buscou; Esc fecha', async () => {
    const probe = open();
    await userEvent.type(screen.getByRole('combobox', { name: 'Buscar' }), 'zzzz');
    expect(screen.getByText('Nada encontrado para “zzzz”.')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(probe.closed()).toBe(1);
  });
});
