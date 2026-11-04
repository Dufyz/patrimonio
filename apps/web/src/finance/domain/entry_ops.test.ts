import { describe, expect, it } from 'vitest';

import {
  FUTURE_DATE,
  addEntry,
  canInstall,
  installmentCount,
  installmentSummary,
  draftOfEntry,
  emptyEntryDraft,
  launchEntry,
  deleteEntries,
  deleteImpact,
  moveAccount,
  moveBlockedReason,
  recategorize,
  updateEntry,
  splitDifference,
  validateEntry,
} from './entry_ops.js';
import { indicators, queryEntries } from './ledger.js';
import { syncRecurring } from './recurring.js';
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

describe('novo lançamento (FIN-307)', () => {
  const draft = {
    ...emptyEntryDraft(TODAY),
    description: 'Padaria',
    categoryId: 'mercado',
    value: '32,50',
    sourceId: 'itau-corrente',
  };

  it('aparece no dia certo e recalcula a faixa', () => {
    const next = addEntry(data, { ...draft, date: '2026-10-20' }, TODAY);
    const created = next.entries.find((e) => e.description === 'Padaria');
    expect(created).toMatchObject({ date: '2026-10-20', status: 'lancada', cents: 3250 });
    const october = currentMonth(TODAY);
    const before = indicators(queryEntries(data, '', {}), october).despesas;
    const after = indicators(queryEntries(next, '', {}), october).despesas;
    expect(after.cents - before.cents).toBe(3250);
    expect(after.count - before.count).toBe(1);
  });

  it('não cria lançamento inválido nem de data futura', () => {
    expect(addEntry(data, { ...draft, date: '2026-10-25' }, TODAY)).toBe(data);
    expect(addEntry(data, { ...draft, description: '' }, TODAY)).toBe(data);
  });

  it('guarda as duas origens', () => {
    const next = addEntry(
      data,
      {
        ...draft,
        value: '100,00',
        split: true,
        firstValue: '60,00',
        secondSourceId: 'flex',
        secondValue: '40,00',
      },
      TODAY,
    );
    expect(next.entries.at(-1)?.payments).toEqual([
      { sourceId: 'itau-corrente', cents: 6000 },
      { sourceId: 'flex', cents: 4000 },
    ]);
  });

  describe('parcelamento no cartão (RN-45)', () => {
    const card = { ...draft, sourceId: 'itau-visa', value: '100,00', installments: '3' };

    it('só cartão aceita parcelas', () => {
      expect(canInstall(card)).toBe(true);
      expect(canInstall({ ...card, sourceId: 'itau-corrente' })).toBe(false);
      expect(installmentCount({ ...card, sourceId: 'itau-corrente' })).toBe(1);
    });

    it('o resumo mostra n parcelas de R$ x', () => {
      expect(installmentSummary({ ...card, value: '300,00' })).toBe(
        '3 parcelas de R$ 100,00',
      );
      expect(installmentSummary(card)).toBe('3 parcelas: 1ª de R$ 33,34 e 2 de R$ 33,33');
      expect(installmentSummary({ ...card, installments: '1' })).toBeNull();
    });

    it('gera N parcelas com o resto na primeira: a 1ª lançada, as demais previstas', () => {
      const next = addEntry(data, { ...card, date: '2026-10-20' }, TODAY);
      const parts = next.entries.filter((e) => e.installment !== undefined);
      expect(parts.map((p) => p.cents)).toEqual([3334, 3333, 3333]);
      expect(parts.map((p) => p.date)).toEqual([
        '2026-10-20',
        '2026-11-20',
        '2026-12-20',
      ]);
      expect(parts.map((p) => p.status)).toEqual(['lancada', 'prevista', 'prevista']);
      expect(parts.map((p) => `${p.installment?.n}/${p.installment?.of}`)).toEqual([
        '1/3',
        '2/3',
        '3/3',
      ]);
      expect(parts.reduce((t, p) => t + p.cents, 0)).toBe(10000);
    });

    it('limita a 24 parcelas', () => {
      expect(validateEntry(data, { ...card, installments: '25' }, TODAY)).toHaveProperty(
        'installments',
      );
    });
  });
});

describe('corrigir lançamentos (FIN-308)', () => {
  it('editar atualiza valor, data, categoria e origens', () => {
    const draft = {
      ...draftOfEntry(entry('l-internet'), TODAY),
      value: '55,00',
      categoryId: 'mercado',
    };
    const next = updateEntry(data, 'l-internet', draft, TODAY);
    expect(next.entries.find((e) => e.id === 'l-internet')).toMatchObject({
      cents: 5500,
      categoryId: 'mercado',
      payments: [{ sourceId: 'itau-corrente', cents: 5500 }],
    });
  });

  it('previsto não se edita por aqui', () => {
    expect(
      updateEntry(data, 'l-spotify', draftOfEntry(entry('l-spotify'), TODAY), TODAY),
    ).toBe(data);
  });

  it('excluir de recorrente não regenera o previsto (RN-06)', () => {
    const next = deleteEntries(data, ['l-netflix']);
    expect(next.entries.some((e) => e.id === 'l-netflix')).toBe(false);
    expect(next.skips).toContain('r-netflix:2026-10');
    expect(
      syncRecurring(next, TODAY).entries.some(
        (e) => e.recurringId === 'r-netflix' && e.date.startsWith('2026-10'),
      ),
    ).toBe(false);
  });

  it('excluir lançamento avulso não cria skip', () => {
    expect(deleteEntries(data, ['l-freela']).skips).toContain('r-freela:2026-10');
    const solo = addEntry(
      data,
      {
        ...emptyEntryDraft(TODAY),
        description: 'x',
        categoryId: 'mercado',
        value: '1,00',
        sourceId: 'itau-corrente',
      },
      TODAY,
    );
    const id = solo.entries.at(-1)!.id;
    expect(deleteEntries(solo, [id]).skips).toEqual([]);
  });

  it('excluir reverte o efeito nos totais', () => {
    const october = currentMonth(TODAY);
    const before = indicators(queryEntries(data, '', {}), october).despesas;
    const after = indicators(
      queryEntries(deleteEntries(data, ['l-netflix']), '', {}),
      october,
    ).despesas;
    expect(before.cents - after.cents).toBe(5590);
  });

  it('a frase de impacto cita as origens', () => {
    expect(deleteImpact([entry('l-luz')])).toBe(
      'Flex recupera R$ 150,00; Itaú Corrente recupera R$ 162,40',
    );
  });

  it('recategorizar só aceita categoria do mesmo tipo', () => {
    expect(
      recategorize(data, ['l-internet'], 'mercado').entries.find(
        (e) => e.id === 'l-internet',
      )?.categoryId,
    ).toBe('mercado');
    expect(recategorize(data, ['l-internet'], 'salario')).toBe(data);
  });

  it('mover de conta troca a origem; cartão e duas origens são bloqueados', () => {
    const moved = moveAccount(data, ['l-internet'], 'nubank-conta');
    expect(moved.entries.find((e) => e.id === 'l-internet')?.payments).toEqual([
      { sourceId: 'nubank-conta', cents: 5000 },
    ]);
    expect(moveBlockedReason(entry('l-netflix'))).toMatch(/cartão/);
    expect(moveBlockedReason(entry('l-luz'))).toMatch(/duas origens/);
    expect(moveAccount(data, ['l-netflix'], 'nubank-conta')).toBe(data);
    expect(moveAccount(data, ['l-internet', 'l-luz'], 'nubank-conta')).toBe(data);
    expect(moveAccount(data, ['l-freela'], 'flex')).toBe(data);
  });
});
