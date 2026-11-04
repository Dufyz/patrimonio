import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';

import { FinanceShell } from './components/finance_shell.js';
import { FinancePeriodProvider, useFinancePeriod } from './components/period_provider.js';
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

/**
 * FIN-001 · As rotas de Finanças, sob `/financas`.
 *
 * Cada tela entra na sua fase. Até lá ela abre vazia, e diz qual história a
 * entrega — nunca uma tela em branco.
 */

const Pending = ({
  title,
  story,
}: {
  readonly title: string;
  readonly story: string;
}): React.ReactElement => (
  <div className="flex flex-col gap-1 rounded-panel border border-line bg-panel p-6">
    <h1 className="text-screen-title font-semibold">{title}</h1>
    <p className="text-[0.8125rem] text-ink-3">Esta tela chega com {story}.</p>
  </div>
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
  return (
    <FinanceStoreProvider>
      <FinancePeriodProvider>
        <RecurringSync />
        <FinanceShell onOpenSearch={() => {}}>
          <Routes>
            <Route path="/" element={<Navigate to="visao-geral" replace />} />
            <Route
              path="visao-geral"
              element={<Pending title="Visão geral" story="FIN-601" />}
            />
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
      </FinancePeriodProvider>
    </FinanceStoreProvider>
  );
};
