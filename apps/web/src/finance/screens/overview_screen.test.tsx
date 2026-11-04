import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('Receitas × despesas (FIN-602)', () => {
  it('painel com subtítulo, legenda do mês do período e 12 meses no eixo', () => {
    open();
    const panel = screen.getByRole('region', { name: 'Receitas × despesas' });
    expect(within(panel).getByText('últimos 12 meses')).toBeTruthy();
    expect(within(panel).getByText('Receitas R$ 16.350')).toBeTruthy();
    expect(within(panel).getByText('Despesas R$ 9.478')).toBeTruthy();
    const months = panel.querySelectorAll('[data-month]');
    expect(months).toHaveLength(12);
    expect(months[0]?.getAttribute('data-month')).toBe('2025-11');
    expect(months[11]?.getAttribute('data-month')).toBe('2026-10');
  });

  it('o mês em andamento é o único com o tom cheio', () => {
    open();
    const panel = screen.getByRole('region', { name: 'Receitas × despesas' });
    expect(panel.querySelectorAll('[data-strong="true"]')).toHaveLength(1);
    expect(
      panel.querySelector('[data-month="2026-10"]')?.getAttribute('data-strong'),
    ).toBe('true');
  });

  it('o tooltip mostra mês, receitas, despesas e saldo', async () => {
    open();
    const panel = screen.getByRole('region', { name: 'Receitas × despesas' });
    await userEvent.hover(panel.querySelector('[data-month="2026-10"]')!);
    const tip = within(screen.getByRole('tooltip'));
    expect(tip.getByText('out/2026')).toBeTruthy();
    expect(screen.getByRole('tooltip').textContent).toContain('R$ 16.350,00');
    expect(screen.getByRole('tooltip').textContent).toContain('R$ 9.478,10');
    expect(screen.getByRole('tooltip').textContent).toContain('R$ 6.871,90');
  });
});
