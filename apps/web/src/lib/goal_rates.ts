import { useCallback } from 'react';

import { MAX_RATE } from './investment_plan.js';
import { usePlan } from './investment_plan_store.js';

/**
 * A rentabilidade esperada de cada carteira (id → taxa nominal ao ano, em %) é a
 * mesma da Projeção: vive no plano, neste navegador, e Objetivos a lê e a grava
 * ali. Carteira sem taxa (zero) usa a premissa do próprio objetivo.
 */
export type Rates = Readonly<Record<string, string>>;

export const useGoalRates = (): {
  readonly rates: Rates;
  readonly setRate: (portfolioId: string, rate: string | null) => void;
} => {
  const { plan, set } = usePlan();

  const rates: Rates = Object.fromEntries(
    Object.entries(plan.rates)
      .filter(([, bp]) => bp > 0)
      .map(([id, bp]) => [id, (bp / 100).toFixed(2)]),
  );

  const setRate = useCallback(
    (portfolioId: string, rate: string | null) => {
      const bp =
        rate === null
          ? 0
          : Math.min(MAX_RATE, Math.max(0, Math.round(Number(rate) * 100)));
      set({ ...plan, rates: { ...plan.rates, [portfolioId]: bp } });
    },
    [plan, set],
  );

  return { rates, setRate };
};
