import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';

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

/** As telas de fluxo chegam por conta própria, com o esqueleto de cada uma. */
export const FinanceOverview = lazy(() =>
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
export const StatusGate = ({ children }: { readonly children: React.ReactNode }) => {
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
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={store.dismissError}
          >
            Dispensar
          </button>
        </div>
      )}
      {children}
    </>
  );
};

/**
 * O dono dos dados de Finanças: a foto do servidor, o período e o "hoje". Mora
 * na casca, acima de tudo: Geral, Finanças e a busca global leem do mesmo lugar,
 * e é por isso que o mesmo número aparece igual em todas (RN-70) sem ler o
 * servidor duas vezes. Quem espera a primeira foto é `StatusGate`.
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
        {children}
      </FinancePeriodProvider>
    </FinanceStoreProvider>
  );
};

/**
 * As telas de fluxo, com caminho absoluto (NAV-01), que esperam os provedores
 * acima. A Visão geral é da raiz e vem de `FinanceOverview`.
 */
export const financeScreenRoutes = (
  <>
    <Route
      path="/lancamentos"
      element={
        <Suspense
          fallback={<TableScreenSkeleton label="Carregando Lançamentos" stats={4} />}
        >
          <EntriesScreen />
        </Suspense>
      }
    />
    <Route
      path="/contas"
      element={
        <Suspense
          fallback={<TableScreenSkeleton label="Carregando Contas" stats={3} rows={5} />}
        >
          <AccountsScreen />
        </Suspense>
      }
    />
    <Route
      path="/contas/:id"
      element={
        <Suspense fallback={<DetailSkeleton label="Carregando extrato" />}>
          <StatementScreen />
        </Suspense>
      }
    />
    <Route
      path="/cartoes"
      element={
        <Suspense
          fallback={<TableScreenSkeleton label="Carregando Cartões" stats={3} rows={5} />}
        >
          <CardsScreen />
        </Suspense>
      }
    />
    <Route
      path="/cartoes/:id"
      element={
        <Suspense fallback={<DetailSkeleton label="Carregando fatura" />}>
          <CardScreen />
        </Suspense>
      }
    />
    <Route
      path="/recorrentes"
      element={
        <Suspense
          fallback={<TableScreenSkeleton label="Carregando Recorrentes" stats={3} />}
        >
          <RecurringsScreen />
        </Suspense>
      }
    />
    <Route
      path="/categorias"
      element={
        <Suspense fallback={<TableScreenSkeleton label="Carregando Categorias" />}>
          <CategoriesScreen />
        </Suspense>
      }
    />
  </>
);

/** O módulo de Finanças sozinho, para os testes das telas. */
export const FinanceRoutes = (): React.ReactElement => (
  <Routes>
    {financeScreenRoutes}
    <Route path="*" element={<Navigate to="/lancamentos" replace />} />
  </Routes>
);

export const FinanceApp = ({
  store,
}: {
  readonly store?: FinanceStore | undefined;
}): React.ReactElement => (
  <FinanceProviders store={store}>
    <StatusGate>
      <FinanceRoutes />
    </StatusGate>
  </FinanceProviders>
);

/** O que Geral e Finanças têm em comum: os dados de Finanças. */
export const FinanceHost = (): React.ReactElement => (
  <StatusGate>
    <Outlet />
  </StatusGate>
);
