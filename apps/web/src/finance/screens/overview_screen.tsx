import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Panel } from '../../components/primitives.js';
import { CategoryBreakdown } from '../components/category_breakdown.js';
import { FlowChart } from '../components/flow_chart.js';
import { PanelBoundary } from '../components/states.js';
import { FinanceWelcome } from '../components/finance_welcome.js';
import { EntryDialog } from '../components/entry_dialog.js';
import { OverviewLedger } from '../components/overview_ledger.js';
import { PeriodControl } from '../components/period_control.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { OverviewStrip } from '../components/overview_strip.js';
import { ScreenHeader } from '../components/screen_header.js';
import {
  categoryBreakdown,
  ledgerCard,
  monthResult,
  monthSeries,
} from '../domain/overview.js';
import { addEntry, emptyEntryDraft } from '../domain/entry_ops.js';
import { formatMonth } from '../lib/format.js';
import { PRIMARY_LABELS, pluralize } from '../lib/header.js';
import { formatRange, isWholeMonth } from '../lib/period.js';
import { financeRoutes } from '../lib/routes.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';

/**
 * Visão geral (prancha 01): como estou no mês, de onde vem e para onde vai o
 * dinheiro. Só resume números que as outras telas produzem.
 */
export const OverviewScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const store = useFinanceStore();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { range, setRange, today } = useFinancePeriod();
  const result = monthResult(data, range, today);
  const series = monthSeries(data, range, today);
  const breakdown = categoryBreakdown(data, range);
  const ledger = ledgerCard(data, range);

  const firstUse =
    data.accounts.length === 0 && data.cards.length === 0 && data.entries.length === 0;

  if (firstUse) {
    return (
      <>
        <ScreenHeader title="Visão geral" subtitle="Finanças · receitas e despesas" />
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
        period={<PeriodControl value={range} onChange={setRange} today={today} />}
        primary={{ label: PRIMARY_LABELS.entries, onClick: () => setCreating(true) }}
      />
      <div className="flex flex-col gap-4">
        <PanelBoundary title="o resultado do período">
          <OverviewStrip result={result} range={range} today={today} />
        </PanelBoundary>
        <Panel
          title="Receitas × despesas"
          action={<span className="text-xs text-ink-3">últimos 12 meses</span>}
        >
          <PanelBoundary title="o gráfico">
            <FlowChart points={series} />
          </PanelBoundary>
        </Panel>
        <PanelBoundary title="as despesas por categoria">
          <CategoryBreakdown
            breakdown={breakdown}
            categories={data.categories}
            range={range}
            today={today}
          />
        </PanelBoundary>
        <PanelBoundary title="os lançamentos">
          <OverviewLedger
            data={data}
            posted={ledger.posted}
            planned={ledger.planned}
            today={today}
          />
        </PanelBoundary>
      </div>

      {creating ? (
        <EntryDialog
          mode="new"
          onSaveAndNew={(draft) =>
            store.set((current) => addEntry(current, draft, today))
          }
          data={data}
          today={today}
          initial={emptyEntryDraft(today)}
          onClose={() => setCreating(false)}
          onCreateRecurring={() => navigate(financeRoutes.recurrings())}
          onSave={(draft) => {
            store.set((current) => addEntry(current, draft, today));
            setCreating(false);
          }}
        />
      ) : null}
    </>
  );
};
