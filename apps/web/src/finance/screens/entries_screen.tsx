import { useMemo } from 'react';

import { LedgerStrip } from '../components/ledger_strip.js';
import { PeriodControl } from '../components/period_control.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { ScreenHeader } from '../components/screen_header.js';
import { indicators as computeIndicators, queryEntries } from '../domain/ledger.js';
import { EMPTY_FILTERS } from '../lib/filters.js';
import { PRIMARY_LABELS } from '../lib/header.js';
import { useFinanceData } from '../store/finance_store.js';

/**
 * Lançamentos: o que entrou, o que saiu e o que ainda falta lançar no período.
 * Esta tela cresce história a história (FIN-301 a FIN-311).
 */
export const EntriesScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const { range, setRange, today } = useFinancePeriod();

  const entries = useMemo(() => queryEntries(data, '', EMPTY_FILTERS), [data]);
  const indicators = useMemo(() => computeIndicators(entries, range), [entries, range]);

  return (
    <>
      <ScreenHeader
        title="Lançamentos"
        subtitle="Todas as contas e cartões · por dia, do mais recente ao mais antigo"
        period={<PeriodControl value={range} onChange={setRange} today={today} />}
        primary={{ label: PRIMARY_LABELS.entries, onClick: () => {} }}
      />
      <div className="flex flex-col gap-4">
        <LedgerStrip indicators={indicators} range={range} today={today} />
      </div>
    </>
  );
};
