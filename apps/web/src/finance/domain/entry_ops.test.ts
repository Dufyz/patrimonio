import { describe, expect, it } from 'vitest';

import {
  FUTURE_DATE,
  draftOfEntry,
  emptyEntryDraft,
  launchEntry,
  splitDifference,
  validateEntry,
} from './entry_ops.js';
import { indicators, queryEntries } from './ledger.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';
import { currentMonth } from '../lib/period.js';

const TODAY = SEED_REFERENCE_DATE;
const data = seedData();
const entry = (id: string) => {
  const found = data.entries.find((e) => e.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};

describe('rascunho de um previsto', () => {
  it('traz descrição, categoria, origem e o valor estimado', () => {
    expect(draftOfEntry(entry('l-spotify'), TODAY)).toMatchObject({
      description: 'Spotify',
      categoryId: 'assinaturas',
      sourceId: 'itau-visa',
      value: '21,90',
    });
  });

  it('a data é a do previsto, ou hoje quando a do previsto é futura (FIN-306)', () => {
    expect(draftOfEntry(entry('l-spotify'), TODAY).date).toBe(TODAY);
    expect(draftOfEntry(entry('l-spotify'), '2026-10-30').date).toBe('2026-10-30');
    expect(draftOfEntry(entry('l-spotify'), '2026-11-05').date).toBe('2026-10-30');
  });

  it('despesa de duas origens traz as partes', () => {
    expect(draftOfEntry(entry('l-luz'), TODAY)).toMatchObject({
      split: true,
      sourceId: 'flex',
      firstValue: '150,00',
      secondSourceId: 'itau-corrente',
      secondValue: '162,40',
    });
  });
});

describe('validação (RN-01, RN-03, RN-21)', () => {
  const valid = {
    ...emptyEntryDraft(TODAY),
    description: 'Padaria',
    categoryId: 'mercado',
    value: '32,50',
    sourceId: 'itau-visa',
  };

  it('um lançamento completo é válido', () => {
    expect(validateEntry(data, valid, TODAY)).toEqual({});
  });

  it('pede os campos obrigatórios', () => {
    const errors = validateEntry(data, emptyEntryDraft(TODAY), TODAY);
    expect(Object.keys(errors).sort()).toEqual([
      'categoryId',
      'description',
      'sourceId',
      'value',
    ]);
  });

  it('não aceita data futura, mas aceita hoje e o passado', () => {
    expect(validateEntry(data, { ...valid, date: '2026-10-25' }, TODAY)).toEqual({
      date: FUTURE_DATE,
    });
    expect(validateEntry(data, { ...valid, date: TODAY }, TODAY)).toEqual({});
    expect(validateEntry(data, { ...valid, date: '2026-01-02' }, TODAY)).toEqual({});
  });

  it('a categoria é do mesmo tipo', () => {
    expect(
      validateEntry(data, { ...valid, categoryId: 'salario' }, TODAY),
    ).toHaveProperty('categoryId');
  });

  it('receita só aceita conta ou Carteira', () => {
    const receita = { ...valid, kind: 'receita' as const, categoryId: 'salario' };
    expect(validateEntry(data, { ...receita, sourceId: 'flex' }, TODAY)).toHaveProperty(
      'sourceId',
    );
    expect(
      validateEntry(data, { ...receita, sourceId: 'itau-visa' }, TODAY),
    ).toHaveProperty('sourceId');
    expect(validateEntry(data, { ...receita, sourceId: 'carteira' }, TODAY)).toEqual({});
  });

  it('duas origens: a soma das partes precisa fechar', () => {
    const split = {
      ...valid,
      value: '100,00',
      split: true,
      firstValue: '60,00',
      secondSourceId: 'flex',
      secondValue: '30,00',
    };
    expect(splitDifference(split)).toBe(1000);
    expect(validateEntry(data, split, TODAY)).toHaveProperty('sum');
    const closed = { ...split, secondValue: '40,00' };
    expect(splitDifference(closed)).toBe(0);
    expect(validateEntry(data, closed, TODAY)).toEqual({});
  });

  it('as duas origens precisam ser diferentes', () => {
    const split = {
      ...valid,
      value: '100,00',
      split: true,
      firstValue: '60,00',
      secondSourceId: 'itau-visa',
      secondValue: '40,00',
    };
    expect(validateEntry(data, split, TODAY)).toHaveProperty('secondSourceId');
  });
});

describe('lançar previsto (RN-02, RN-12)', () => {
  const october = currentMonth(TODAY);
  const totals = (d = data) => indicators(queryEntries(d, '', {}), october);

  it('passa a lançado com o valor real, na data real, e entra nos totais', () => {
    const draft = { ...draftOfEntry(entry('l-gasto-livre'), TODAY), value: '4.512,30' };
    const next = launchEntry(data, 'l-gasto-livre', draft, TODAY);
    const launched = next.entries.find((e) => e.id === 'l-gasto-livre');
    expect(launched).toMatchObject({ status: 'lancada', date: TODAY, cents: 451230 });
    expect(launched?.payments).toEqual([{ sourceId: 'nubank-conta', cents: 451230 }]);
    expect(totals(next).despesas.cents).toBe(totals().despesas.cents + 451230);
    expect(totals(next).aLancar.count).toBe(totals().aLancar.count - 1);
  });

  it('não altera o valor cadastrado do recorrente', () => {
    const draft = { ...draftOfEntry(entry('l-gasto-livre'), TODAY), value: '1,00' };
    const next = launchEntry(data, 'l-gasto-livre', draft, TODAY);
    expect(next.recurrings).toBe(data.recurrings);
  });

  it('recusa data futura e soma que não fecha', () => {
    const base = draftOfEntry(entry('l-luz'), TODAY);
    expect(
      launchEntry(
        data,
        'l-gasto-livre',
        { ...draftOfEntry(entry('l-gasto-livre'), TODAY), date: '2026-10-31' },
        TODAY,
      ),
    ).toBe(data);
    expect(
      launchEntry(
        data,
        'l-spotify',
        { ...draftOfEntry(entry('l-spotify'), TODAY), value: '' },
        TODAY,
      ),
    ).toBe(data);
    expect(base.split).toBe(true);
  });

  it('só previsto pode ser lançado', () => {
    expect(
      launchEntry(data, 'l-netflix', draftOfEntry(entry('l-netflix'), TODAY), TODAY),
    ).toBe(data);
  });
});
