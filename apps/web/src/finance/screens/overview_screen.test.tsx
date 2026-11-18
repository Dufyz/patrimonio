import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

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
                <Route path="/lancamentos" element={<p>Lançamentos aberto</p>} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

describe('Composição da tela (prancha 1.2)', () => {
  it('o subtítulo diz "Fluxo", o mês e o dia', () => {
    open();
    expect(screen.getByText(/Fluxo · out\/2026 · dia 24 de 31/u)).toBeTruthy();
  });

  it('tem a faixa de indicadores e os painéis da prancha, sem Contas nem a faixa antiga', () => {
    open();
    expect(screen.getByRole('region', { name: 'Indicadores do mês' })).toBeTruthy();
    for (const name of [
      'Saldo previsto em contas',
      'Despesas por categoria',
      'Próximos lançamentos',
      'Faturas abertas',
      'Aportes do mês',
      'Receitas × despesas',
    ]) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('region', { name: 'Contas' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Resultado do mês' })).toBeNull();
  });

  it('a faixa tem as cinco células da prancha', () => {
    open();
    const faixa = screen.getByRole('region', { name: 'Indicadores do mês' });
    for (const label of [
      'Receitas',
      'Despesas',
      'Aportes',
      'Saldo do mês',
      'Saldo previsto em contas',
    ]) {
      expect(within(faixa).getByText(label)).toBeTruthy();
    }
  });
});

describe('Despesas por categoria (prancha 1.2)', () => {
  const row = (
    id: string,
    name: string,
    amount: string,
    projected: string,
    nature: string,
  ) => ({
    category_id: id,
    name,
    color: 'blue',
    amount,
    planned: '0.00',
    projected,
    nature,
    count: 1,
    tenths: 500,
  });
  const breakdown = {
    total: '300.00',
    projected_total: '450.00',
    count: 3,
    rows: [
      row('c2', 'Mercado', '100.00', '150.00', 'livre'),
      row('c1', 'Moradia', '200.00', '300.00', 'fixa'),
    ],
  };

  it('mostra lançado, previsto no mês e a natureza, com as fixas primeiro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/categories/breakdown')
          ? new Response(JSON.stringify(breakdown), { status: 200 })
          : new Response('{}', { status: 500 }),
      ),
    );
    open();
    const painel = screen.getByRole('region', { name: 'Despesas por categoria' });
    const tabela = await within(painel).findByRole('table', {
      name: 'Despesas por categoria',
    });
    const linhas = within(tabela).getAllByRole('row').slice(1);
    expect(linhas[0]?.textContent).toContain('Moradia');
    expect(linhas[0]?.textContent).toContain('fixa');
    expect(linhas[1]?.textContent).toContain('Mercado');
    expect(linhas[1]?.textContent).toContain('livre');
    const total = within(tabela).getByRole('row', { name: /Total de despesas/ });
    expect(total.textContent).toContain('300,00');
    expect(total.textContent).toContain('450,00');
    expect(painel.textContent).toContain('Só consumo');
    vi.unstubAllGlobals();
  });
});

describe('Novo lançamento', () => {
  it('o botão Lançamento abre o formulário', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /^Lançamento/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('a Visão geral não tem mais o card de lançamentos', () => {
    open();
    expect(screen.queryByRole('region', { name: 'Lançamentos' })).toBeNull();
  });
});
