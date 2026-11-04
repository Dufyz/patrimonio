import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useShortcuts } from '../components/shortcuts.js';
import { Navigate, Route, Routes, useLocation } from 'react-router';

import { FinanceSearch } from './components/finance_search.js';
import { FinanceShell } from './components/finance_shell.js';
import { FinancePeriodProvider, useFinancePeriod } from './components/period_provider.js';

import {
  DetailSkeleton,
  OverviewSkeleton,
  SettingsSkeleton,
  TableScreenSkeleton,
} from './components/screen_skeletons.js';
import { syncBenefitCredits } from './domain/benefits.js';
import { syncRecurring } from './domain/recurring.js';
import { FinanceStoreProvider, useFinanceStore } from './store/finance_store.js';
import { setTodayOverride, todayFromSearch } from './lib/clock.js';

/** FIN-001 · As rotas de Finanças, sob `/financas`. Cada tela chega por conta própria, com o esqueleto dela. */
const OverviewScreen = lazy(() =>
  import('./screens/overview_screen.js').then((module) => ({
    default: module.OverviewScreen,
  })),
);
const CardScreen = lazy(() =>
  import('./screens/card_screen.js').then((module) => ({ default: module.CardScreen })),
);
const CardsScreen = lazy(() =>
  import('./screens/cards_screen.js').then((module) => ({ default: module.CardsScreen })),
);
const AccountsScreen = lazy(() =>
  import('./screens/accounts_screen.js').then((module) => ({
    default: module.AccountsScreen,
  })),
);
const StatementScreen = lazy(() =>
  import('./screens/statement_screen.js').then((module) => ({
    default: module.StatementScreen,
  })),
);
const EntriesScreen = lazy(() =>
  import('./screens/entries_screen.js').then((module) => ({
    default: module.EntriesScreen,
  })),
);
const RecurringsScreen = lazy(() =>
  import('./screens/recurrings_screen.js').then((module) => ({
    default: module.RecurringsScreen,
  })),
);
const CategoriesScreen = lazy(() =>
  import('./screens/categories_screen.js').then((module) => ({
    default: module.CategoriesScreen,
  })),
);
const SettingsScreen = lazy(() =>
  import('./screens/settings_screen.js').then((module) => ({
    default: module.SettingsScreen,
  })),
);

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
            <Route
              path="visao-geral"
              element={
                <Suspense fallback={<OverviewSkeleton />}>
                  <OverviewScreen />
                </Suspense>
              }
            />
            <Route
              path="lancamentos"
              element={
                <Suspense
                  fallback={
                    <TableScreenSkeleton label="Carregando Lançamentos" stats={4} />
                  }
                >
                  <EntriesScreen />
                </Suspense>
              }
            />
            <Route
              path="contas"
              element={
                <Suspense
                  fallback={
                    <TableScreenSkeleton label="Carregando Contas" stats={3} rows={5} />
                  }
                >
                  <AccountsScreen />
                </Suspense>
              }
            />
            <Route
              path="contas/:id"
              element={
                <Suspense fallback={<DetailSkeleton label="Carregando extrato" />}>
                  <StatementScreen />
                </Suspense>
              }
            />
            <Route
              path="cartoes"
              element={
                <Suspense
                  fallback={
                    <TableScreenSkeleton label="Carregando Cartões" stats={3} rows={5} />
                  }
                >
                  <CardsScreen />
                </Suspense>
              }
            />
            <Route
              path="cartoes/:id"
              element={
                <Suspense fallback={<DetailSkeleton label="Carregando fatura" />}>
                  <CardScreen />
                </Suspense>
              }
            />
            <Route
              path="recorrentes"
              element={
                <Suspense
                  fallback={
                    <TableScreenSkeleton label="Carregando Recorrentes" stats={3} />
                  }
                >
                  <RecurringsScreen />
                </Suspense>
              }
            />
            <Route
              path="categorias"
              element={
                <Suspense
                  fallback={<TableScreenSkeleton label="Carregando Categorias" />}
                >
                  <CategoriesScreen />
                </Suspense>
              }
            />
            <Route
              path="configuracoes"
              element={
                <Suspense fallback={<SettingsSkeleton />}>
                  <SettingsScreen />
                </Suspense>
              }
            />
            <Route path="*" element={<Navigate to="/financas/visao-geral" replace />} />
          </Routes>
        </FinanceShell>
        <FinanceSearch open={searching} onClose={() => setSearching(false)} />
      </FinancePeriodProvider>
    </FinanceStoreProvider>
  );
};
