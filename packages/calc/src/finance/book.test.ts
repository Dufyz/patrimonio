import { readFileSync } from 'node:fs';

import type { FinSnapshot } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import { bookRows, bookTotals, filterBook, groupBook, paginateBook } from './book.js';
import type { BookInvestmentRow } from './book.js';

const seed = JSON.parse(
  readFileSync(
    new URL('../../../db/src/seeds/finance_demo.json', import.meta.url),
    'utf8',
  ),
) as { snapshot: FinSnapshot };
const data = seed.snapshot;

const inv = (over: Partial<BookInvestmentRow>): BookInvestmentRow => ({
  id: 'i0',
  kind: 'buy',
  date: '2026-10-10',
  portfolio_id: 'p1',
  portfolio_name: 'Longo prazo',
  asset_id: 'a1',
  asset_name: 'ITSA4',
  asset_class: 'acoes',
  quantity: '100',
  unit_price: '10',
  fees: '0',
  net_amount: '1000.00',
  payout_kind: null,
  event_ratio_from: null,
  event_ratio_to: null,
  event_id: null,
  ...over,
});

const RANGE = { from: '2026-10-01', to: '2026-10-31' };
const account = data.accounts[0]?.id ?? '';

describe('livro unificado (LIV-02)', () => {
  const investments = [
    inv({ id: 'i1', event_id: 'e1' }),
    inv({ id: 'i2', kind: 'sell', net_amount: '400.00', date: '2026-10-12' }),
    inv({ id: 'i3', kind: 'payout', payout_kind: 'dividend', net_amount: '25.00' }),
    inv({
      id: 'i4',
      kind: 'corporate_event',
      net_amount: '0',
      event_ratio_from: '1',
      event_ratio_to: '2',
    }),
  ];
  const withLeg: FinSnapshot = {
    ...data,
    movements: [
      ...data.movements,
      {
        id: 'm1',
        date: '2026-10-10',
        account_id: account,
        kind: 'aporte',
        amount: '-1000.00',
        description: 'Aporte',
        note: null,
        transfer_id: null,
        event_id: 'e1',
      },
    ],
  };
  const rows = bookRows(withLeg, investments);

  it('traz os oito tipos na leitura completa e a perna financeira não vira linha', () => {
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds.has('RECEITA') && kinds.has('DESPESA')).toBe(true);
    expect(kinds.has('APORTE') && kinds.has('RESGATE')).toBe(true);
    expect(kinds.has('PROVENTO') && kinds.has('EVENTO')).toBe(true);
    expect(rows.filter((r) => r.kind === 'APORTE')).toHaveLength(1);
  });

  it('o aporte herda a conta da perna financeira ligada pelo event_id', () => {
    expect(rows.find((r) => r.id === 'i1')?.account_id).toBe(account);
    expect(rows.find((r) => r.id === 'i2')?.account_id).toBeNull();
  });

  it('evento só aparece quando o filtro de tipo o inclui', () => {
    expect(
      filterBook(withLeg, rows, { range: RANGE }).some((r) => r.kind === 'EVENTO'),
    ).toBe(false);
    const only = filterBook(withLeg, rows, { range: RANGE, kinds: ['EVENTO'] });
    expect(only.map((r) => r.id)).toEqual(['i4']);
  });

  it('filtra por carteira, ativo e classe', () => {
    expect(
      filterBook(withLeg, rows, { range: RANGE, portfolios: ['p1'] }).every(
        (r) => r.portfolio_id === 'p1',
      ),
    ).toBe(true);
    expect(filterBook(withLeg, rows, { range: RANGE, assets: ['zzz'] })).toHaveLength(0);
    expect(
      filterBook(withLeg, rows, { range: RANGE, classes: ['acoes'], kinds: ['APORTE'] }),
    ).toHaveLength(1);
  });

  it('totais: aporte com conta entra em Aportes; resgate e provento não mexem no saldo', () => {
    const filtered = filterBook(withLeg, rows, { range: RANGE });
    const totals = bookTotals(filtered);
    expect(totals.aportes).toBe('1000.00');
    const without = bookTotals(
      filtered.filter((r) => r.kind !== 'RESGATE' && r.kind !== 'PROVENTO'),
    );
    expect(totals.saldo_do_mes).toBe(without.saldo_do_mes);
  });

  it('aporte "Fora do app" não entra nos Aportes do mês', () => {
    const solo = bookRows(data, [inv({ id: 'x', event_id: null })]);
    expect(bookTotals(solo.filter((r) => r.id === 'x')).aportes).toBe('0.00');
  });

  it('o total dos grupos é igual ao total geral e independe da página', () => {
    const filtered = filterBook(withLeg, rows, { range: RANGE });
    const all = bookTotals(filtered);
    for (const by of ['dia', 'tipo', 'conta_carteira'] as const) {
      const groups = groupBook(withLeg, filtered, by);
      expect(groups.reduce((n, g) => n + g.count, 0)).toBe(filtered.length);
    }
    const page = paginateBook(filtered, undefined, 5);
    expect(page.rows).toHaveLength(Math.min(5, filtered.length));
    expect(bookTotals(filtered).saldo_do_mes).toBe(all.saldo_do_mes);
  });

  it('a paginação por cursor percorre tudo sem repetir', () => {
    const filtered = filterBook(withLeg, rows, { range: RANGE });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 500; guard += 1) {
      const page = paginateBook(filtered, cursor, 7);
      seen.push(...page.rows.map((r) => `${r.kind}:${r.id}`));
      if (page.next_cursor === null) break;
      cursor = page.next_cursor;
    }
    expect(seen).toHaveLength(filtered.length);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('ordem estável: previstos antes de lançados no mesmo dia', () => {
    const filtered = filterBook(withLeg, rows, { range: RANGE });
    for (let i = 1; i < filtered.length; i += 1) {
      const a = filtered[i - 1];
      const b = filtered[i];
      if (a === undefined || b === undefined) continue;
      expect(a.date >= b.date).toBe(true);
      if (a.date === b.date && a.situation !== b.situation) {
        expect(a.situation).toBe('previsto');
      }
    }
  });
});
