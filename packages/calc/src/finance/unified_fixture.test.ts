import { readFileSync } from 'node:fs';

import type { FinSnapshot } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import { accountBalance } from './accounts.js';
import { bookRows, bookTotals, filterBook } from './book.js';
import type { BookInvestmentRow } from './book.js';
import { monthCascade, wealthSummary } from './wealth.js';
import { dec, money } from './money.js';
import { overview } from './overview.js';

/** LIV-16 · O fixture de 11/11/2026 (§2.3): os números da especificação, de ponta a ponta. */
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../db/src/seeds/unified_fixture.json', import.meta.url),
    'utf8',
  ),
) as {
  reference_date: string;
  snapshot: FinSnapshot;
  investments: BookInvestmentRow[];
  planned_aportes: { date: string; amount: string; account_id: string }[];
  carteiras: { investimentos: string; emergencia: string };
};
const TODAY = fixture.reference_date;
const data = fixture.snapshot;
const emCarteiras = money(
  dec(fixture.carteiras.investimentos).plus(fixture.carteiras.emergencia),
);

describe('fixture unificado (LIV-16)', () => {
  it('contas: 1.022,86 + 439,65 + 0,00 = 1.462,51', () => {
    const ov = overview(data, '2026-11', TODAY);
    expect(ov.em_contas.amount).toBe('1462.51');
    const balance = (id: string) => money(accountBalance(data, id, TODAY));
    expect(balance('nubank-conta')).toBe('1022.86');
    expect(balance('itau')).toBe('439.65');
    expect(balance('flash')).toBe('0.00');
  });

  it('faturas: abertas 2.167,42, fechadas 2.100,95, devido 4.268,37', () => {
    const w = wealthSummary(data, TODAY, emCarteiras);
    expect(w.abertas).toBe('2167.42');
    expect(w.fechadas_a_pagar).toBe('2100.95');
    expect(w.total_devido).toBe('4268.37');
  });

  it('carteiras 194.998,09, patrimônio 196.460,60, livre R$ 0,00 e faltam 2.805,86', () => {
    const w = wealthSummary(data, TODAY, emCarteiras);
    expect(w.em_carteiras).toBe('194998.09');
    expect(w.patrimonio).toBe('196460.60');
    expect(w.livre).toBe('0.00');
    expect(w.falta).toBe('2805.86');
  });

  it('novembro: 8.720,00 − 3.842,43 − 2.000,00 = 2.877,57', () => {
    const rows = bookRows(data, fixture.investments);
    const filtered = filterBook(data, rows, {
      range: { from: '2026-11-01', to: '2026-11-30' },
    });
    const t = bookTotals(filtered);
    expect(t.receitas).toBe('8720.00');
    expect(t.despesas).toBe('3842.43');
    expect(t.aportes).toBe('2000.00');
    expect(t.saldo_do_mes).toBe('2877.57');
    expect(
      monthCascade({ receitas: t.receitas, despesas: t.despesas, aportes: t.aportes })
        .saldo_do_mes,
    ).toBe('2877.57');
  });

  it('saldo previsto em 30/11 = 130,16 (RN-U9)', () => {
    const rows = bookRows(data, fixture.investments);
    const t = bookTotals(
      filterBook(data, rows, { range: { from: '2026-11-01', to: '2026-11-30' } }),
    );
    const aportesPrevistos = fixture.planned_aportes.reduce(
      (sum, a) => sum.plus(a.amount),
      dec('0'),
    );
    // Faturas que vencem até 30/11: fechadas a pagar e a aberta do Nubank (vence dia 28).
    const w = wealthSummary(data, TODAY, emCarteiras);
    const faturasAte30 = dec(w.fechadas_a_pagar).plus('1207.36');
    const previsto = dec(w.em_contas)
      .plus(t.previsto.receitas)
      .minus(t.previsto.despesas)
      .minus(aportesPrevistos)
      .minus(faturasAte30);
    expect(money(previsto)).toBe('130.16');
  });

  it('não existe a categoria "Investimento" (LIV-15)', () => {
    expect(data.categories.some((c) => c.name === 'Investimento')).toBe(false);
  });
});
