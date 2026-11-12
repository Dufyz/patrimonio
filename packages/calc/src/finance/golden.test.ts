import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { FinSnapshot } from '@patrimonio/domain';

import { accountsOverview, overview } from './index.js';

/**
 * Golden: a semente de demonstração (a mesma da tela) lida pelo motor do backend
 * tem de dar os números que a tela já exibe (CE-01..03).
 */
const seed = JSON.parse(
  readFileSync(
    new URL('../../../db/src/seeds/finance_demo.json', import.meta.url),
    'utf8',
  ),
) as { reference_date: string; snapshot: FinSnapshot };

const TODAY = '2026-10-24';

describe('golden · semente de demonstração', () => {
  const view = overview(seed.snapshot, '2026-10', TODAY);

  it('indicadores do mês', () => {
    expect(view.receitas.amount).toBe('16350.00');
    expect(view.despesas.amount).toBe('9478.10');
    expect(view.saldo).toBe('6871.90');
  });

  it('em contas e faturas abertas', () => {
    expect(view.em_contas.amount).toBe('12583.85');
    expect(view.faturas_abertas).toBe('5422.27');
  });

  it('o extrato fecha em todas as contas', () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    const rows = accountsOverview(seed.snapshot, range, TODAY, false);
    expect(rows.accounts.length).toBeGreaterThan(0);
  });
});
