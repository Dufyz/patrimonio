import { describe, expect, it } from 'vitest';

import {
  accountsTotal,
  cashOutlook,
  defaultHorizon,
  investmentCategoryIds,
  monthFlow,
} from './cash_flow.js';
import { projectBalance, startingBalance } from './projection.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';

const data = seedData();
const TODAY = SEED_REFERENCE_DATE;

describe('saldo previsto (FVG-001)', () => {
  const horizon = '2026-12-31';
  const outlook = cashOutlook(data, TODAY, horizon);

  it('parte de Em contas hoje', () => {
    expect(outlook.startCents).toBe(startingBalance(data, TODAY));
    expect(accountsTotal(data, TODAY)).toBe(outlook.startCents);
  });

  it('saldo previsto = em contas + entradas previstas − saídas previstas', () => {
    expect(outlook.endCents).toBe(
      outlook.startCents + outlook.entradasCents - outlook.saidasCents,
    );
    expect(outlook.variationCents).toBe(outlook.endCents - outlook.startCents);
  });

  it('é o mesmo resultado da projeção de Finanças', () => {
    const projection = projectBalance(data, TODAY, horizon);
    expect(outlook.endCents).toBe(projection.endCents);
    expect(outlook.lowest).toEqual(projection.lowest);
    expect(outlook.days).toHaveLength(projection.days.length);
  });

  it('o horizonte padrão é o último dia do mês seguinte', () => {
    expect(defaultHorizon('2026-11-11')).toBe('2026-12-31');
    expect(defaultHorizon('2026-12-05')).toBe('2027-01-31');
    expect(defaultHorizon('2027-01-31')).toBe('2027-02-28');
  });
});

describe('fluxo do mês (GER-004)', () => {
  const flow = monthFlow(data, TODAY);

  it('o saldo previsto do fim do mês vem da mesma função do saldo previsto', () => {
    expect(flow.saldoPrevistoCents).toBe(
      cashOutlook(data, TODAY, flow.monthEnd).endCents,
    );
  });

  it('Em contas hoje e Faturas abertas são as posições de hoje', () => {
    expect(flow.emContasCents).toBe(startingBalance(data, TODAY));
    expect(flow.faturasAbertasCents).toBeGreaterThanOrEqual(0);
  });

  it('aportes previstos são parte das despesas previstas, nunca mais que elas', () => {
    expect(flow.aportesPrevistosCents).toBeLessThanOrEqual(flow.despesasPrevistasCents);
  });

  it('identifica a categoria Investimentos pelo nome, no singular ou plural, sem caixa', () => {
    const ids = investmentCategoryIds({
      ...data,
      categories: [
        { id: 'c1', name: ' INVESTIMENTOS ', kind: 'despesa', color: 'blue' },
        { id: 'c2', name: 'Mercado', kind: 'despesa', color: 'red' },
        { id: 'c4', name: 'Investimento', kind: 'despesa', color: 'blue' },
        { id: 'c3', name: 'Investimentos', kind: 'receita', color: 'green' },
      ],
    });
    expect([...ids]).toEqual(['c1', 'c4']);
  });
});
