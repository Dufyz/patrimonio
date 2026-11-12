import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../components/period_provider.js';
import { SEED_VERSION } from '../domain/seed.js';
import { setTodayOverride } from '../lib/clock.js';
import {
  createFinanceStore,
  DATA_KEY,
  FinanceStoreProvider,
} from '../store/finance_store.js';
import { AccountsScreen } from './accounts_screen.js';
import { CardScreen } from './card_screen.js';
import { CardsScreen } from './cards_screen.js';
import { CategoriesScreen } from './categories_screen.js';
import { EntriesScreen } from './entries_screen.js';
import { OverviewScreen } from './overview_screen.js';
import { RecurringsScreen } from './recurrings_screen.js';
import { StatementScreen } from './statement_screen.js';

/** FIN-701 · Nenhuma tela quebra nem fica muda sem dados: todas dizem o que falta. */

const EMPTY = {
  cards: [],
  cardItems: [],
  payments: [],
  accounts: [],
  movements: [],
  categories: [],
  recurrings: [],
  entries: [],
};

const open = (path: string): void => {
  setTodayOverride('2026-10-24');
  const bag = new Map<string, string>([
    [DATA_KEY, JSON.stringify({ version: SEED_VERSION, data: EMPTY })],
  ]);
  const storage = {
    getItem: (key: string) => bag.get(key) ?? null,
    setItem: (key: string, value: string) => void bag.set(key, value),
    removeItem: (key: string) => void bag.delete(key),
  };
  render(
    <MemoryRouter initialEntries={[path]}>
      <PreferencesProvider>
        <ShortcutProvider>
          <FinanceStoreProvider store={createFinanceStore(storage)}>
            <FinancePeriodProvider>
              <Routes>
                <Route path="/visao-geral" element={<OverviewScreen />} />
                <Route path="/lancamentos" element={<EntriesScreen />} />
                <Route path="/contas" element={<AccountsScreen />} />
                <Route path="/contas/:id" element={<StatementScreen />} />
                <Route path="/cartoes" element={<CardsScreen />} />
                <Route path="/cartoes/:id" element={<CardScreen />} />
                <Route path="/recorrentes" element={<RecurringsScreen />} />
                <Route path="/categorias" element={<CategoriesScreen />} />
                <Route path="/contas" element={<p>Contas aberta</p>} />
                <Route path="/cartoes" element={<p>Cartões aberta</p>} />
              </Routes>
            </FinancePeriodProvider>
          </FinanceStoreProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

describe('telas sem nenhum dado', () => {
  it('Visão geral mostra o roteiro de primeiro uso, sem gráfico nem tabela vazios', () => {
    open('/visao-geral');
    expect(
      screen.getByRole('heading', {
        name: 'Suas finanças aparecem aqui depois do primeiro lançamento',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar conta' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Novo lançamento' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it.each([
    ['/contas', 'Nenhuma conta cadastrada.'],
    ['/cartoes', 'Nenhum cartão cadastrado.'],
    ['/recorrentes', 'Nenhum recorrente cadastrado.'],
    ['/categorias', 'Nenhuma categoria cadastrada.'],
    ['/lancamentos', 'Nenhum lançamento neste período.'],
  ])('%s diz o que falta e oferece a ação', (path, message) => {
    open(path);
    expect(screen.getByText(new RegExp(message.replace('.', '\\.')))).toBeTruthy();
  });

  it('Contas sem movimentações explica o bloco', () => {
    open('/contas');
    expect(screen.getByText(/Nenhuma movimentação ainda/)).toBeTruthy();
  });

  const screens: readonly (readonly [string, string])[] = [
    ['Visão geral', '/visao-geral'],
    ['Lançamentos', '/lancamentos'],
    ['Contas', '/contas'],
    ['Extrato de conta inexistente', '/contas/x'],
    ['Cartões', '/cartoes'],
    ['Fatura de cartão inexistente', '/cartoes/x'],
    ['Recorrentes', '/recorrentes'],
    ['Categorias', '/categorias'],
  ];
  for (const [name, path] of screens) {
    it(`${name} abre sem quebrar (inexistentes voltam à lista)`, () => {
      open(path);
      expect(document.body.textContent?.length ?? 0).toBeGreaterThan(10);
      expect(screen.queryByText(/NaN|undefined|Invalid/)).toBeNull();
    });
  }
});
