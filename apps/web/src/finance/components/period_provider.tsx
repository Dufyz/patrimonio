import { createContext, useContext, useMemo, useState } from 'react';

import { today as clockToday } from '../lib/clock.js';
import { currentMonth } from '../lib/period.js';
import type { DateRange } from '../lib/period.js';

/**
 * FIN-003 · O período compartilhado.
 *
 * Visão geral e Lançamentos leem o mesmo intervalo, então escolher um período
 * numa tela e abrir a outra mantém a escolha. O padrão é o mês corrente. O
 * período não persiste entre sessões (FIN-007): ao abrir, é sempre o mês
 * corrente.
 */

type PeriodValue = {
  readonly range: DateRange;
  readonly setRange: (range: DateRange) => void;
  readonly today: string;
};

const PeriodContext = createContext<PeriodValue | null>(null);

export const FinancePeriodProvider = ({
  children,
  initial,
}: {
  readonly children: React.ReactNode;
  readonly initial?: DateRange | undefined;
}): React.ReactElement => {
  const [range, setRange] = useState<DateRange>(
    () => initial ?? currentMonth(clockToday()),
  );
  const value = useMemo<PeriodValue>(
    () => ({ range, setRange, today: clockToday() }),
    [range],
  );
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
};

export const useFinancePeriod = (): PeriodValue => {
  const value = useContext(PeriodContext);
  if (value === null) {
    throw new Error('useFinancePeriod precisa de um FinancePeriodProvider acima.');
  }
  return value;
};
