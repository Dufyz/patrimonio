import { readFileSync } from 'node:fs';

import type { FinSnapshot } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import { projectedBalance } from './forecast.js';
import { totalInAccounts } from './accounts.js';
import { money } from './money.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../db/src/seeds/unified_fixture.json', import.meta.url),
    'utf8',
  ),
) as {
  reference_date: string;
  snapshot: FinSnapshot;
  planned_aportes: { date: string; amount: string; account_id: string }[];
};
const TODAY = fixture.reference_date;
const data = fixture.snapshot;

describe('saldo previsto (LIV-10)', () => {
  it('hoje, sem nada vencendo, é o que há em contas menos o que já venceu e não foi pago', () => {
    const hoje = projectedBalance(data, TODAY, TODAY);
    expect(Number(hoje)).toBeLessThanOrEqual(Number(money(totalInAccounts(data, TODAY))));
  });

  it('aporte previsto reduz o saldo na data; "Fora do app" não reduz', () => {
    const sem = Number(projectedBalance(data, '2026-11-30', TODAY));
    const com = Number(
      projectedBalance(data, '2026-11-30', TODAY, fixture.planned_aportes),
    );
    const total = fixture.planned_aportes.reduce((sum, a) => sum + Number(a.amount), 0);
    expect(sem - com).toBeCloseTo(total, 2);

    const fora = fixture.planned_aportes.map((a) => ({ ...a, account_id: null }));
    expect(Number(projectedBalance(data, '2026-11-30', TODAY, fora))).toBeCloseTo(sem, 2);
  });

  it('aporte previsto depois da data não entra', () => {
    const depois = fixture.planned_aportes.map((a) => ({ ...a, date: '2026-12-31' }));
    expect(projectedBalance(data, '2026-11-30', TODAY, depois)).toBe(
      projectedBalance(data, '2026-11-30', TODAY),
    );
  });

  it('previstos vencidos continuam somando enquanto não forem lançados', () => {
    const vencido = {
      ...data,
      entries: [
        ...data.entries,
        {
          ...data.entries[0]!,
          id: 'vencido-1',
          kind: 'despesa' as const,
          status: 'prevista' as const,
          date: '2026-10-01',
          amount: '100.00',
          installment: null,
          recurring_id: null,
          payments: [
            {
              source_type: 'conta' as const,
              source_id: 'itau',
              amount: '100.00',
              invoice_month: null,
            },
          ],
        },
      ],
    };
    const base = Number(projectedBalance(data, '2026-11-30', TODAY));
    expect(Number(projectedBalance(vencido, '2026-11-30', TODAY))).toBeCloseTo(
      base - 100,
      2,
    );
  });
});
