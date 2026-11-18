import { readFileSync } from 'node:fs';

import type { FinSnapshot } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import {
  bookRows,
  bookTotals,
  filterBook,
  flowSeries,
  groupBook,
  paginateBook,
} from './book.js';
import type { BookInvestmentRow, BookRow } from './book.js';

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

describe('cascata do mês: fixas, livres, projetado e taxa de aporte', () => {
  const row = (over: Partial<BookRow>): BookRow => ({
    id: 'r',
    kind: 'DESPESA',
    date: '2026-11-05',
    situation: 'lancado',
    description: 'x',
    amount: '0.00',
    account_id: 'c1',
    to_account_id: null,
    card_id: null,
    category_id: null,
    portfolio_id: null,
    asset_id: null,
    asset_class: null,
    quantity: null,
    unit_price: null,
    fees: null,
    entry: null,
    event_id: null,
    ...over,
  });
  const natureOf = (r: BookRow) => (r.category_id === 'fixa' ? 'fixa' : 'livre');
  // Novembro da prancha: receitas 8.720,00 (+1.500,00 previstos), despesas fixas
  // 3.129,80 (+530,30), livres 712,63 (+887,37), aportes 2.000,00 (+1.000,00).
  const rows: readonly BookRow[] = [
    row({ id: 'a', kind: 'RECEITA', amount: '8720.00' }),
    row({ id: 'b', kind: 'RECEITA', amount: '1500.00', situation: 'previsto' }),
    row({ id: 'c', amount: '3129.80', category_id: 'fixa' }),
    row({ id: 'd', amount: '530.30', category_id: 'fixa', situation: 'previsto' }),
    row({ id: 'e', amount: '712.63', category_id: 'mercado' }),
    row({ id: 'f', amount: '887.37', category_id: null, situation: 'previsto' }),
    row({ id: 'g', kind: 'APORTE', amount: '2000.00' }),
    row({ id: 'h', kind: 'APORTE', amount: '1000.00', situation: 'previsto' }),
  ];

  it('fixas mais livres fecham com o total de despesas, lançado e previsto', () => {
    const t = bookTotals(rows, natureOf);
    expect(t.despesas).toBe('3842.43');
    expect(t.despesas_fixas).toBe('3129.80');
    expect(t.despesas_livres).toBe('712.63');
    expect(t.previsto.despesas_fixas).toBe('530.30');
    expect(t.previsto.despesas_livres).toBe('887.37');
  });

  it('o projetado é o lançado mais o que falta lançar, e o saldo fecha', () => {
    const t = bookTotals(rows, natureOf);
    expect(t.projetado).toEqual({
      receitas: '10220.00',
      despesas: '5260.10',
      despesas_fixas: '3660.10',
      despesas_livres: '1600.00',
      aportes: '3000.00',
      saldo_do_mes: '1959.90',
    });
    expect(t.saldo_do_mes).toBe('2877.57');
  });

  it('taxa de aporte: 22,9% lançada e 29,4% prevista; sem receita é nula', () => {
    const t = bookTotals(rows, natureOf);
    expect(t.taxa_aporte).toEqual({ lancada: '22.9', prevista: '29.4' });
    const none = bookTotals(
      rows.filter((r) => r.kind === 'APORTE'),
      natureOf,
    );
    expect(none.taxa_aporte).toEqual({ lancada: null, prevista: null });
  });

  it('sem a função de natureza, toda despesa é livre', () => {
    const t = bookTotals(rows);
    expect(t.despesas_fixas).toBe('0.00');
    expect(t.despesas_livres).toBe('3842.43');
  });
});

describe('flowSeries', () => {
  it('devolve um ponto por mês pedido, na ordem, zerado quando o mês não tem linhas', () => {
    const months = ['2026-09', '2026-10', '2026-11'];
    const series = flowSeries([], months);

    expect(series.map((point) => point.month)).toEqual(months);
    expect(series[0]?.receitas).toBe('0.00');
    expect(series[2]?.projetado.aportes).toBe('0.00');
  });
});
