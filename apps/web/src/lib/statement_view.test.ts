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
