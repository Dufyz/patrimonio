import { PeriodControl } from '../components/period_control.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { OverviewStrip } from '../components/overview_strip.js';
import { ScreenHeader } from '../components/screen_header.js';
import { monthResult } from '../domain/overview.js';
import { useFinanceData } from '../store/finance_store.js';

/**
 * Visão geral (prancha 01): como estou no mês, de onde vem e para onde vai o
 * dinheiro. Só resume números que as outras telas produzem.
 */
export const OverviewScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const { range, setRange, today } = useFinancePeriod();
  const result = monthResult(data, range, today);

  return (
    <>
      <ScreenHeader
        title="Visão geral"
        subtitle="Como estou no período, de onde vem e para onde vai o dinheiro"
        period={<PeriodControl value={range} onChange={setRange} today={today} />}
      />
      <div className="flex flex-col gap-4">
        <OverviewStrip result={result} range={range} today={today} />
      </div>
    </>
  );
};
