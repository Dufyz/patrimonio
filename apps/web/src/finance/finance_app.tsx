import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRegisterSearch } from '../components/shell_search.js';
import { useShortcuts } from '../components/shortcuts.js';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';

import { FinanceSearch } from './components/finance_search.js';
import { FinancePeriodProvider, useFinancePeriod } from './components/period_provider.js';

import {
  DetailSkeleton,
  OverviewSkeleton,
  TableScreenSkeleton,
} from './components/screen_skeletons.js';
import { PanelError } from './components/states.js';
import { syncRecurring } from './domain/recurring.js';
import {
  createRemoteFinanceStore,
  FinanceStoreProvider,
  useFinanceStatus,
  useFinanceStore,
} from './store/finance_store.js';
import type { FinanceStore } from './store/finance_store.js';
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
 * lança os automáticos que já venceram.
 * Idempotente — repetir não muda nada.
 */
const RecurringSync = (): null => {
  const store = useFinanceStore();
  const { today } = useFinancePeriod();
  useEffect(() => {
    // Com a API, quem gera previstos e créditos é o servidor (ao abrir e todo dia).
    if (store.remote) return;
    store.set((data) => syncRecurring(data, today));
  }, [store, today]);
  return null;
};

/**
 * Enquanto a primeira foto não chega, o esqueleto; se ela falha, a causa e
 * "Tentar novamente". Uma escrita que falha não tira a tela do ar: aparece um
 * aviso no topo, e a foto relida mostra o que o servidor tem de fato.
 */
const StatusGate = ({ children }: { readonly children: React.ReactNode }) => {
  const store = useFinanceStore();
  const status = useFinanceStatus();
  useEffect(() => {
    store.start();
  }, [store]);
  if (status.phase === 'loading') return <OverviewSkeleton />;
  if (status.phase === 'error') {
    return (
      <div className="p-6">
        <PanelError
          title="Não foi possível carregar Finanças"
          cause={status.error ?? undefined}
          onRetry={store.start}
        />
      </div>
    );
  }
  return (
    <>
      {status.error === null ? null : (
        <div
          role="alert"
          className="mx-6 mt-4 flex items-center justify-between gap-4 rounded-panel border border-negative/40 bg-panel px-4 py-2 text-[0.8125rem]"
        >
          <span>{status.error}</span>
          <button type="button" className="underline" onClick={store.dismissError}>
            Dispensar
          </button>
        </div>
      )}
      {children}
    </>
  );
};

/**
 * O dono dos dados de Finanças: a foto do servidor, o período e o "hoje". Geral
 * e Finanças leem do mesmo lugar, e é por isso que o mesmo número aparece igual
 * nas duas áreas (RN-70) sem ler o servidor duas vezes.
 */
export const FinanceProviders = ({
  store,
  children,
}: {
  readonly store?: FinanceStore | undefined;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  useTodayFromUrl();
  const [remote] = useState(() => store ?? createRemoteFinanceStore());
  return (
    <FinanceStoreProvider store={remote}>
      <FinancePeriodProvider>
        <RecurringSync />
        <StatusGate>{children}</StatusGate>
      </FinancePeriodProvider>
    </FinanceStoreProvider>
  );
};

/** As telas de Finanças, que esperam os provedores acima. */
export const FinanceRoutes = (): React.ReactElement => {
  const [searching, setSearching] = useState(false);
  const shortcuts = useMemo(() => ({ search: () => setSearching(true) }), []);
  useShortcuts(shortcuts);
  // O botão de buscar da barra lateral abre a busca de Finanças.
  useRegisterSearch(useCallback(() => setSearching(true), []));
  return (
    <>
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
              fallback={<TableScreenSkeleton label="Carregando Lançamentos" stats={4} />}
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
              fallback={<TableScreenSkeleton label="Carregando Recorrentes" stats={3} />}
            >
              <RecurringsScreen />
            </Suspense>
          }
        />
        <Route
          path="categorias"
          element={
            <Suspense fallback={<TableScreenSkeleton label="Carregando Categorias" />}>
              <CategoriesScreen />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/financas/visao-geral" replace />} />
      </Routes>
      <FinanceSearch open={searching} onClose={() => setSearching(false)} />
    </>
  );
};

export const FinanceApp = ({
  store,
}: {
  readonly store?: FinanceStore | undefined;
}): React.ReactElement => (
  <FinanceProviders store={store}>
    <FinanceRoutes />
  </FinanceProviders>
);

/** O que Geral e Finanças têm em comum: os dados de Finanças. */
export const FinanceHost = (): React.ReactElement => (
  <FinanceProviders>
    <Outlet />
  </FinanceProviders>
);
