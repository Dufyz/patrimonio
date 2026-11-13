import { describe, expect, it } from 'vitest';

import {
  chipsOf,
  EMPTY_FILTERS,
  filtersFromParams,
  filtersToParams,
  hasFilters,
  removeChip,
} from './ledger_filters.js';

describe('ledger_filters', () => {
  it('vai e volta pela URL sem perder parâmetros alheios', () => {
    const f = { ...EMPTY_FILTERS, q: 'luz', tipo: ['DESPESA', 'APORTE'] };
    const params = filtersToParams(f, new URLSearchParams('agrupar=tipo'));
    expect(params.get('agrupar')).toBe('tipo');
    expect(filtersFromParams(params)).toEqual(f);
  });

  it('chips removíveis e limpeza', () => {
    const f = { ...EMPTY_FILTERS, q: 'x', situacao: ['previsto'] };
    const chips = chipsOf(f);
    expect(chips.map((c) => c.key)).toEqual(['q', 'situacao']);
    const left = chips.reduce(removeChip, f);
    expect(hasFilters(left)).toBe(false);
  });
});
