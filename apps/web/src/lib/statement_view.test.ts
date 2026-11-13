import { describe, expect, it } from 'vitest';

import type { StatementLineResource } from '../api/statement_view.js';
import { newestFirst, statementCloses, typeLabel } from './statement_view.js';

const line = (over: Partial<StatementLineResource>): StatementLineResource => ({
  id: 'l',
  date: '2026-11-01',
  origin: 'lancamento',
  description: 'd',
  note: null,
  category_id: null,
  amount: '-10.00',
  tags: [],
  entry_id: null,
  balance_after: '0',
  ...over,
});

describe('statement_view', () => {
  it('fecha quando saldo inicial + entradas − saídas = saldo final', () => {
    expect(
      statementCloses({
        opening: '100.00',
        entered: '50.25',
        left: '20.10',
        closing: '130.15',
      }),
    ).toBe(true);
    expect(
      statementCloses({
        opening: '100.00',
        entered: '50.25',
        left: '20.10',
        closing: '130.16',
      }),
    ).toBe(false);
  });

  it('da mais nova à mais antiga', () => {
    const lines = [line({ id: 'a' }), line({ id: 'b' })];
    expect(newestFirst(lines).map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('tipo: lançamento vira receita ou despesa pelo sinal; o resto pela origem', () => {
    expect(typeLabel(line({ amount: '10.00' }))).toBe('Receita');
    expect(typeLabel(line({ amount: '-10.00' }))).toBe('Despesa');
    expect(typeLabel(line({ origin: 'aporte' }))).toBe('Aporte');
    expect(typeLabel(line({ origin: 'fatura' }))).toBe('Fatura');
  });
});

import {
  dailySeries,
  filterLines,
  lowestPoint,
  matchesQuery,
  sumAmounts,
} from './statement_view.js';

describe('statement_view · série e filtros', () => {
  const lines = [
    line({
      id: 'a',
      date: '2026-11-02',
      amount: '50.00',
      balance_after: '150.00',
      description: 'Salário',
    }),
    line({
      id: 'b',
      date: '2026-11-02',
      amount: '-20.00',
      balance_after: '130.00',
      description: 'Mercado',
    }),
    line({
      id: 'c',
      date: '2026-11-05',
      origin: 'aporte',
      amount: '-100.00',
      balance_after: '30.00',
      description: 'Aporte PETR4',
    }),
  ];

  it('o saldo do dia é o saldo após a última movimentação do dia', () => {
    const pts = dailySeries(
      { opening: '100.00', range: { from: '2026-11-01', to: '2026-11-06' }, lines },
      '2026-11-04',
    );
    expect(pts.map((p) => p.balance)).toEqual([
      '100.00',
      '130.00',
      '130.00',
      '130.00',
      '30.00',
      '30.00',
    ]);
    expect(pts.map((p) => p.projected)).toEqual([false, false, false, false, true, true]);
    expect(lowestPoint(pts)?.date).toBe('2026-11-05');
  });

  it('busca por descrição e por valor; filtro por tipo; soma do filtrado', () => {
    expect(matchesQuery(lines[0]!, 'sal')).toBe(true);
    expect(matchesQuery(lines[1]!, '20,00')).toBe(true);
    expect(matchesQuery(lines[1]!, '99')).toBe(false);
    const f = filterLines(lines, '', ['despesa', 'aporte']);
    expect(f.map((l) => l.id)).toEqual(['b', 'c']);
    expect(sumAmounts(f)).toBe('-120.00');
    // o saldo após não muda com o filtro
    expect(f[0]?.balance_after).toBe('130.00');
  });
});
