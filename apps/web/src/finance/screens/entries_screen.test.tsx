import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { setTodayOverride } from '../lib/clock.js';
import { createFinanceStore, FinanceStoreProvider } from '../store/finance_store.js';
import { EntriesScreen } from './entries_screen.js';

const open = () => {
  setTodayOverride('2026-10-24');
  return render(
    <MemoryRouter>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(null)}>
            <FinancePeriodProvider>
              <EntriesScreen />
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

describe('faixa de indicadores (FIN-301)', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('mostra título, subtítulo e o período', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Lançamentos' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Todas as contas e cartões · por dia, do mais recente ao mais antigo',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Período: 01/10 – 31/10' }),
    ).toBeInTheDocument();
  });

  it('tem as quatro células com os valores da prancha 02A', () => {
    open();
    const strip = screen.getByRole('region', { name: 'Indicadores do período' });
    const cell = (label: string) => {
      const term = within(strip).getByText(label);
      const box = term.parentElement;
      if (box === null) throw new Error(label);
      return within(box);
    };
    expect(cell('Receitas').getByText(/16\.350,00/)).toBeInTheDocument();
    expect(cell('Receitas').getByText('3 lançamentos')).toBeInTheDocument();
    expect(cell('Despesas').getByText(/9\.478,10/)).toBeInTheDocument();
    expect(cell('Despesas').getByText('9 lançamentos')).toBeInTheDocument();
    const saldo = cell('Saldo do período').getByText(/6\.871,90/);
    expect(saldo.textContent).toMatch(/^\+\s?R\$/);
    expect(cell('Ainda a lançar').getByText(/6\.871,90/)).toBeInTheDocument();
    expect(cell('Ainda a lançar').getByText('3 previstos até 31/10')).toBeInTheDocument();
  });

  it('o botão principal é Lançamento com o selo N', () => {
    open();
    expect(screen.getByRole('button', { name: /Lançamento/ })).toBeInTheDocument();
  });
});
