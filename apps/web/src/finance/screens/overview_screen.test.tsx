import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { OverviewScreen } from './overview_screen.js';

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter initialEntries={['/visao-geral']}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <Routes>
                <Route path="/visao-geral" element={<OverviewScreen />} />
                <Route path="/financas/lancamentos" element={<p>Lançamentos aberto</p>} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

describe('Faixa de totais do mês (FIN-601)', () => {
  it('cabeçalho do painel com a etiqueta e o dia do mês', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Resultado de out/2026' })).toBeTruthy();
    expect(screen.getByText('mês em andamento')).toBeTruthy();
    expect(screen.getByText('dia 24 de 31')).toBeTruthy();
  });

  it('cinco células com valores e legendas', () => {
    open();
    const strip = within(screen.getByRole('region', { name: 'Resultado do mês' }));
    const cell = (label: string) =>
      strip.getByText(label).parentElement?.textContent ?? '';
    expect(cell('Receitas')).toContain('R$ 16.350,00');
    expect(cell('Receitas')).toContain('3 lançamentos');
    expect(cell('Despesas')).toContain('R$ 9.478,10');
    expect(cell('Despesas')).toContain('9 lançamentos');
    expect(cell('Saldo do mês')).toContain('R$ 6.871,90');
    expect(cell('Em contas')).toContain('R$ 11.773,15');
    expect(cell('Em contas')).toContain('3 contas');
    expect(cell('Faturas abertas')).toContain('R$ 5.422,27');
    expect(cell('Faturas abertas')).toContain('Itaú 30/10 · Nubank 05/11');
  });
});
