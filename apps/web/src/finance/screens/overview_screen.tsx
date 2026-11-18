import { useState } from 'react';

import { HomeScopeControl } from '../../components/home_scope_control.js';
import { AportesDoMesPanel } from '../components/aportes_do_mes.js';
import { FluxoStats } from '../components/fluxo_stats.js';
import { ReceitasDespesasPanel } from '../components/receitas_despesas.js';
import { SaldoPrevistoContasPanel } from '../components/saldo_previsto_contas.js';
import { PanelBoundary } from '../components/states.js';
import { DespesasCategoriaServerPanel } from '../components/despesas_categoria_server.js';
import { FinanceWelcome } from '../components/finance_welcome.js';
import { NewEntryModal } from '../../views/ledger/new_entry_modal.js';
import { FlowPeriodControl as PeriodControl } from '../../components/period_control.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { FaturasAbertasPanel } from '../components/overview_panels.js';
import { ProximosLancamentosPanel } from '../components/proximos_lancamentos.js';
import { ScreenHeader } from '../components/screen_header.js';
import { formatDayOfMonth, formatMonth } from '../lib/format.js';
import { PRIMARY_LABELS } from '../lib/header.js';
import { formatRange, isWholeMonth } from '../lib/period.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';

/**
 * Visão geral (prancha 01): como estou no mês, para onde o saldo vai e de onde
 * vem e para onde vai o dinheiro. Só resume números que as outras telas
 * produzem; a projeção é leitura sobre os mesmos dados.
 */
export const OverviewScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const store = useFinanceStore();
  const [creating, setCreating] = useState(false);
  const { range, setRange, today } = useFinancePeriod();
  const firstUse =
    data.accounts.length === 0 && data.cards.length === 0 && data.entries.length === 0;

  if (firstUse) {
    return (
      <>
        <ScreenHeader
          title="Visão geral"
          subtitle="Finanças · receitas e despesas"
          period={<HomeScopeControl scope="fluxo" />}
        />
        <div className="flex flex-col gap-4">
          <FinanceWelcome data={data} today={today} />
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader
        title="Visão geral"
        subtitle={`Fluxo · ${isWholeMonth(range) ? formatMonth(range.from) : formatRange(range, today)}${isWholeMonth(range) && range.from.slice(0, 7) === today.slice(0, 7) ? ` · ${formatDayOfMonth(today)}` : ''}`}
        period={
          <span className="flex flex-wrap items-center gap-2">
            <HomeScopeControl scope="fluxo" />
            <PeriodControl value={range} onChange={setRange} today={today} />
          </span>
        }
        primary={{ label: PRIMARY_LABELS.entries, onClick: () => setCreating(true) }}
      />
      <div className="flex flex-col gap-4">
        <PanelBoundary title="os indicadores do mês">
          <FluxoStats today={today} />
        </PanelBoundary>
        {/* Cards na mesma linha têm a mesma altura (grid com itens esticados). */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PanelBoundary title="o saldo previsto">
            <SaldoPrevistoContasPanel today={today} />
          </PanelBoundary>
          <PanelBoundary title="as despesas por categoria">
            <DespesasCategoriaServerPanel range={range} today={today} />
          </PanelBoundary>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <PanelBoundary title="as próximas movimentações">
            <ProximosLancamentosPanel today={today} />
          </PanelBoundary>
          <div className="flex min-w-0 flex-col gap-4">
            <PanelBoundary title="as faturas abertas">
              <FaturasAbertasPanel data={data} today={today} />
            </PanelBoundary>
            <PanelBoundary title="os aportes do mês">
              <AportesDoMesPanel data={data} today={today} />
            </PanelBoundary>
          </div>
        </div>
        <ReceitasDespesasPanel today={today} />
      </div>

      {creating ? (
        <NewEntryModal
          today={today}
          accounts={data.accounts
            .filter((account) => account.archived !== true)
            .map((account) => ({ id: account.id, name: account.name }))}
          onSaved={() => store.start()}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
};
