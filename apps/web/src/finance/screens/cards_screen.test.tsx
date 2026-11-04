import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { CardsScreen } from './cards_screen.js';

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter initialEntries={['/cartoes']}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <Routes>
                <Route path="/cartoes" element={<CardsScreen />} />
                <Route path="/financas/cartoes/:id" element={<p>Fatura aberta</p>} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

const rowOf = (name: string): HTMLElement =>
  screen.getByRole('row', { name: new RegExp(name) });

describe('Cartões (FIN-501)', () => {
  it('subtítulo com faturas abertas e próximo vencimento', () => {
    open();
    expect(
      screen.getByRole('heading', { name: 'Cartões' }).parentElement?.textContent,
    ).toContain(
      'Faturas abertas R$ 5.422,27 · próximo vencimento 30/10 (Itaú Visa e Itaú Mastercard)',
    );
  });

  it('agrupa os cartões pela conta que paga', () => {
    open();
    const table = screen.getByRole('table', { name: 'Cartões por conta' });
    expect(within(table).getByText('Nubank Conta paga 1 cartão')).toBeTruthy();
    expect(within(table).getByText('Itaú Corrente paga 2 cartões')).toBeTruthy();
  });

  it('mostra fatura, situação, vencimento e limite usado', () => {
    open();
    const nubank = rowOf('Nubank Mastercard').textContent ?? '';
    expect(nubank).toContain('final 9082');
    expect(nubank).toContain('R$ 3.482,17');
    expect(nubank).toContain('aberta · fecha 28/10');
    expect(nubank).toContain('05/11');
    expect(nubank).toContain('61,5%');
    const visa = rowOf('Itaú Visa').textContent ?? '';
    expect(visa).toContain('R$ 1.400,10');
    expect(visa).toContain('fechada');
    expect(visa).toContain('30/10');
    expect(visa).toContain('em 6 dias');
    expect(visa).toContain('70,0%');
    expect(rowOf('Itaú Mastercard').textContent).toContain('13,5%');
  });

  it('clicar na linha abre o cartão', async () => {
    open();
    await userEvent.click(rowOf('Nubank Mastercard'));
    expect(screen.getByText('Fatura aberta')).toBeTruthy();
  });
});
