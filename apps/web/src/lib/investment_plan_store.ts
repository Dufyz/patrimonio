import { useCallback, useState } from 'react';

import { EMPTY_PLAN, MAX_RATE, isMonth } from './investment_plan.js';
import type { InvestmentPlan, PlanRule } from './investment_plan.js';
import { browserStorage, readRaw, writeRaw } from './preferences.js';
import type { Storageish } from './preferences.js';

/**
 * O plano de aportes fica neste navegador, como as outras preferências de
 * leitura: é uma hipótese, não um lançamento. O contrato é só `InvestmentPlan`;
 * trocar o `localStorage` por uma rota da `api` mexe neste arquivo e em mais
 * nenhum.
 */

export const PLAN_KEY = 'patrimonio.investments.plan.v2';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isRule = (value: unknown): value is PlanRule =>
  isObject(value) &&
  typeof value['id'] === 'string' &&
  typeof value['portfolioId'] === 'string' &&
  Number.isInteger(value['cents']) &&
  (value['cents'] as number) > 0 &&
  isMonth(value['from']) &&
  (value['until'] === null || isMonth(value['until']));

const percents = (value: unknown): Record<string, number> =>
  isObject(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === 'number' &&
            Number.isInteger(entry[1]) &&
            entry[1] >= 0 &&
            entry[1] <= MAX_RATE,
        ),
      )
    : {};

export const readPlan = (storage: Storageish | null): InvestmentPlan => {
  const raw = readRaw(storage, PLAN_KEY);
  if (raw === null) return EMPTY_PLAN;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return EMPTY_PLAN;
    return {
      rules: Array.isArray(parsed['rules']) ? parsed['rules'].filter(isRule) : [],
      rates: percents(parsed['rates']),
    };
  } catch {
    return EMPTY_PLAN;
  }
};

export const writePlan = (storage: Storageish | null, plan: InvestmentPlan): void =>
  writeRaw(storage, PLAN_KEY, JSON.stringify(plan));

export const usePlan = (
  storage?: Storageish | null,
): { readonly plan: InvestmentPlan; readonly set: (next: InvestmentPlan) => void } => {
  const [resolved] = useState<Storageish | null>(() =>
    storage === undefined ? browserStorage() : storage,
  );
  const [plan, setPlan] = useState<InvestmentPlan>(() => readPlan(resolved));
  const set = useCallback(
    (next: InvestmentPlan) => {
      setPlan(next);
      writePlan(resolved, next);
    },
    [resolved],
  );
  return { plan, set };
};

let counter = 0;
export const newRuleId = (): string => {
  counter += 1;
  return `r-${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
};
