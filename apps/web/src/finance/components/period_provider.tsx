import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useInRouterContext, useSearchParams } from 'react-router';

import { today as clockToday } from '../lib/clock.js';
import { defaultRange, readDisplay } from '../../lib/display_preferences.js';
import { readRangeParams, writeRangeParams } from '../lib/period_url.js';
import type { DateRange } from '../lib/period.js';

/**
 * FIN-003 · O período compartilhado.
 *
 * Visão geral e Lançamentos leem o mesmo intervalo, então escolher um período
 * numa tela e abrir a outra mantém a escolha. O padrão é o mês corrente. O
 * período não persiste entre sessões (FIN-007): ao abrir, vale o padrão.
 */

type PeriodValue = {
  readonly range: DateRange;
  readonly setRange: (range: DateRange) => void;
  readonly today: string;
};

const PeriodContext = createContext<PeriodValue | null>(null);

/** Fora de um roteador (testes de painel) o período vive só em memória. */
const UrlSync = ({
  range,
  fallback,
}: {
  readonly range: DateRange;
  readonly fallback: DateRange;
}): null => {
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const next = writeRangeParams(params, range, fallback);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [range, fallback, params, setParams]);
  return null;
};

const InitialFromUrl = (): DateRange | null => {
  if (typeof globalThis.location === 'undefined') return null;
  return readRangeParams(new URLSearchParams(globalThis.location.search));
};

export const FinancePeriodProvider = ({
  children,
  initial,
}: {
  readonly children: React.ReactNode;
  readonly initial?: DateRange | undefined;
}): React.ReactElement => {
  const inRouter = useInRouterContext();
  const fallback = useMemo(
    () => defaultRange(readDisplay().defaultPeriod, clockToday()),
    [],
  );
  const [range, setRange] = useState<DateRange>(
    () => initial ?? (inRouter ? InitialFromUrl() : null) ?? fallback,
  );
  const value = useMemo<PeriodValue>(
    () => ({ range, setRange, today: clockToday() }),
    [range],
  );
  return (
    <PeriodContext.Provider value={value}>
      {inRouter && initial === undefined ? (
        <UrlSync range={range} fallback={fallback} />
      ) : null}
      {children}
    </PeriodContext.Provider>
  );
};

export const useFinancePeriod = (): PeriodValue => {
  const value = useContext(PeriodContext);
  if (value === null) {
    throw new Error('useFinancePeriod precisa de um FinancePeriodProvider acima.');
  }
  return value;
};
