import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { HomeScopeControl } from '../../components/home_scope_control.js';
import { Panel } from '../../components/primitives.js';
import { FlowChart } from '../components/flow_chart.js';
import { PanelBoundary } from '../components/states.js';
import { FinanceWelcome } from '../components/finance_welcome.js';
import { EntryDialog } from '../components/entry_dialog.js';
import { FlowPeriodControl as PeriodControl } from '../../components/period_control.js';
import { useFinancePeriod } from '../components/period_provider.js';
import {
  ContasPanel,
  DespesasCategoriaPanel,
  FaturasAbertasPanel,
  PanelHeaderAction,
  ProximosLancamentosPanel,
  SaldoPrevistoPanel,
} from '../components/overview_panels.js';
import { ScreenHeader } from '../components/screen_header.js';
import { monthResult, monthSeries } from '../domain/overview.js';
import { projectedMonths } from '../domain/projection.js';
import { emptyEntryDraft } from '../domain/entry_ops.js';
import { formatMonth } from '../lib/format.js';
import { PRIMARY_LABELS, pluralize } from '../lib/header.js';
import { formatRange, isWholeMonth } from '../lib/period.js';
import { financeRoutes } from '../lib/routes.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';
import { commands } from '../store/commands.js';

/** Quantos meses depois do atual o gráfico de receitas × despesas prevê. */
const PROJECTED_MONTHS = 3;

/**
 * Visão geral (prancha 01): como estou no mês, para onde o saldo vai e de onde
 * vem e para onde vai o dinheiro. Só resume números que as outras telas
 * produzem; a projeção é leitura sobre os mesmos dados.
 */
export const OverviewScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const store = useFinanceStore();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { range, setRange, today } = useFinancePeriod();
  const result = monthResult(data, range, today);
  const series = monthSeries(data, range, today);
  const current = series[series.length - 1];
  const future = useMemo(
    () =>
      current?.selected === true && current.inProgress
        ? projectedMonths(data, today, PROJECTED_MONTHS).slice(1)
        : [],
    [data, today, current?.selected, current?.inProgress],
  );

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
        subtitle={`Finanças · ${isWholeMonth(range) ? formatMonth(range.from) : formatRange(range, today)} · receitas e despesas · ${pluralize(result.accountsCount, 'conta', 'contas')} e ${pluralize(data.cards.length, 'cartão', 'cartões')}`}
        period={
          <span className="flex flex-wrap items-center gap-2">
            <HomeScopeControl scope="fluxo" />
            <PeriodControl value={range} onChange={setRange} today={today} />
          </span>
        }
        primary={{ label: PRIMARY_LABELS.entries, onClick: () => setCreating(true) }}
      />
      <div className="flex flex-col gap-4">
        {/* Cards na mesma linha têm a mesma altura (grid com itens esticados). */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PanelBoundary title="o saldo previsto">
            <SaldoPrevistoPanel data={data} today={today} />
          </PanelBoundary>
          <PanelBoundary title="as despesas por categoria">
            <DespesasCategoriaPanel data={data} range={range} today={today} />
          </PanelBoundary>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PanelBoundary title="os próximos lançamentos">
            <ProximosLancamentosPanel data={data} today={today} />
          </PanelBoundary>
          <div className="flex min-w-0 flex-col gap-4">
            <PanelBoundary title="as faturas abertas">
              <FaturasAbertasPanel data={data} today={today} />
            </PanelBoundary>
            <PanelBoundary title="as contas">
              <ContasPanel data={data} today={today} />
            </PanelBoundary>
          </div>
        </div>
        <Panel
          title="Receitas × despesas"
          action={
            <PanelHeaderAction
              hint={`últimos 12 meses${future.length > 0 ? ` e os ${future.length} seguintes` : ''}`}
              more={{ to: financeRoutes.entries(), label: 'Lançamentos' }}
            />
          }
        >
          <PanelBoundary title="o gráfico">
            <FlowChart points={series} projected={future} />
          </PanelBoundary>
        </Panel>
      </div>

      {creating ? (
        <EntryDialog
          mode="new"
          onSaveAndNew={(draft) => store.run(commands.addEntry(draft, today))}
          data={data}
          today={today}
          initial={emptyEntryDraft(today)}
          onClose={() => setCreating(false)}
          onCreateRecurring={() => navigate(financeRoutes.recurrings())}
          onSave={(draft) => {
            store.run(commands.addEntry(draft, today));
            setCreating(false);
          }}
        />
      ) : null}
    </>
  );
};
