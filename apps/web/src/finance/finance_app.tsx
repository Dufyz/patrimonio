import { useEffect, useMemo, useState } from 'react';
import { useShortcuts } from '../components/shortcuts.js';
import { Navigate, Route, Routes, useLocation } from 'react-router';

import { FinanceSearch } from './components/finance_search.js';
import { FinanceShell } from './components/finance_shell.js';
import { FinancePeriodProvider, useFinancePeriod } from './components/period_provider.js';
import { OverviewScreen } from './screens/overview_screen.js';
import { CardScreen } from './screens/card_screen.js';
import { CardsScreen } from './screens/cards_screen.js';
import { AccountsScreen } from './screens/accounts_screen.js';
import { StatementScreen } from './screens/statement_screen.js';
import { EntriesScreen } from './screens/entries_screen.js';
import { RecurringsScreen } from './screens/recurrings_screen.js';
import { CategoriesScreen } from './screens/categories_screen.js';
import { SettingsScreen } from './screens/settings_screen.js';

import { syncBenefitCredits } from './domain/benefits.js';
import { syncRecurring } from './domain/recurring.js';
import { FinanceStoreProvider, useFinanceStore } from './store/finance_store.js';
import { setTodayOverride, todayFromSearch } from './lib/clock.js';

/** FIN-001 · As rotas de Finanças, sob `/financas`. */

/**
 * `?hoje=2026-10-24` fixa o "hoje" da sessão: é como se confere uma tela contra
 * as pranchas, desenhadas em 24/10/2026. Lido uma vez, antes do primeiro quadro.
 */
const useTodayFromUrl = (): void => {
  const { search } = useLocation();
  useState(() => {
    const fixed = todayFromSearch(search);
    if (fixed !== null) setTodayOverride(fixed);
    return null;
  });
};

/**
 * RN-10 e RN-11: ao abrir, gera o previsto do mês de cada recorrente ativo e
 * lança os automáticos que já venceram, e credita os benefícios no dia (RN-36).
 * Idempotente — repetir não muda nada.
 */
const RecurringSync = (): null => {
  const store = useFinanceStore();
  const { today } = useFinancePeriod();
  useEffect(() => {
    store.set((data) => syncBenefitCredits(syncRecurring(data, today), today));
  }, [store, today]);
  return null;
};

export const FinanceApp = (): React.ReactElement => {
  useTodayFromUrl();
  const [searching, setSearching] = useState(false);
  const shortcuts = useMemo(() => ({ search: () => setSearching(true) }), []);
  useShortcuts(shortcuts);
  return (
    <FinanceStoreProvider>
      <FinancePeriodProvider>
        <RecurringSync />
        <FinanceShell onOpenSearch={() => setSearching(true)}>
          <Routes>
            <Route path="/" element={<Navigate to="visao-geral" replace />} />
            <Route path="visao-geral" element={<OverviewScreen />} />
            <Route path="lancamentos" element={<EntriesScreen />} />
            <Route path="contas" element={<AccountsScreen />} />
            <Route path="contas/:id" element={<StatementScreen />} />
            <Route path="cartoes" element={<CardsScreen />} />
            <Route path="cartoes/:id" element={<CardScreen />} />
            <Route path="recorrentes" element={<RecurringsScreen />} />
            <Route path="categorias" element={<CategoriesScreen />} />
            <Route path="configuracoes" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/financas/visao-geral" replace />} />
          </Routes>
        </FinanceShell>
        <FinanceSearch open={searching} onClose={() => setSearching(false)} />
      </FinancePeriodProvider>
    </FinanceStoreProvider>
  );
};
