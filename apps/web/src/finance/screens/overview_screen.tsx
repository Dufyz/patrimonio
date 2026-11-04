import { useState } from 'react';
import { useNavigate } from 'react-router';

import { CategoryBreakdown } from '../components/category_breakdown.js';
import { FlowChart } from '../components/flow_chart.js';
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
import { PRIMARY_LABELS } from '../lib/header.js';
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

  return (
    <>
      <ScreenHeader
        title="Visão geral"
        subtitle="Como estou no período, de onde vem e para onde vai o dinheiro"
        period={<PeriodControl value={range} onChange={setRange} today={today} />}
        primary={{ label: PRIMARY_LABELS.entries, onClick: () => setCreating(true) }}
      />
      <div className="flex flex-col gap-4">
        <OverviewStrip result={result} range={range} today={today} />
        <section
          aria-labelledby="flow-title"
          className="rounded-panel border border-line bg-panel"
        >
          <header className="flex items-baseline justify-between gap-4 px-5 pt-4 pb-2">
            <h2 id="flow-title" className="text-[0.9375rem] font-semibold">
              Receitas × despesas
            </h2>
            <span className="text-xs text-ink-3">últimos 12 meses</span>
          </header>
          <FlowChart points={series} />
        </section>
        <CategoryBreakdown
          breakdown={breakdown}
          categories={data.categories}
          range={range}
          today={today}
        />
        <OverviewLedger
          data={data}
          posted={ledger.posted}
          planned={ledger.planned}
          today={today}
        />
      </div>

      {creating ? (
        <EntryDialog
          mode="new"
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
