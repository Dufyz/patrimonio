import { describe, expect, it } from 'vitest';

import {
  addRecurring,
  dateInMonth,
  deleteRecurring,
  draftOf,
  paymentsFor,
  setRecurringActive,
  syncRecurring,
  updateRecurring,
  validateRecurring,
} from './recurring.js';
import { SEED_RECURRINGS, SEED_REFERENCE_DATE, seedData } from './seed.js';

const TODAY = SEED_REFERENCE_DATE;
const data = seedData();
const find = (id: string) => {
  const recurring = SEED_RECURRINGS.find((r) => r.id === id);
  if (recurring === undefined) throw new Error(id);
  return recurring;
};

describe('data do previsto (RN-10)', () => {
  it('usa o dia do recorrente', () => {
    expect(dateInMonth('2026-10-01', 17)).toBe('2026-10-17');
  });
  it('dia 31 em mês curto cai no último dia', () => {
    expect(dateInMonth('2026-11-01', 31)).toBe('2026-11-30');
    expect(dateInMonth('2028-02-10', 31)).toBe('2028-02-29');
  });
});

describe('partes do pagamento', () => {
  it('uma origem leva o valor todo', () => {
    expect(paymentsFor(find('r-netflix'), 5590)).toEqual([
      { sourceId: 'itau-visa', cents: 5590 },
    ]);
  });
  it('duas origens: a primeira até o limite, a segunda o resto', () => {
    expect(paymentsFor(find('r-luz'), 31240)).toEqual([
      { sourceId: 'flex', cents: 15000 },
      { sourceId: 'itau-corrente', cents: 16240 },
    ]);
    expect(paymentsFor(find('r-luz'), 9000)).toEqual([{ sourceId: 'flex', cents: 9000 }]);
  });
});

describe('geração mensal', () => {
  it('a semente de 24/10 já está em dia: nada a gerar nem a lançar', () => {
    expect(syncRecurring(data, TODAY)).toBe(data);
  });

  it('é idempotente', () => {
    const once = syncRecurring(data, '2026-11-03');
    expect(syncRecurring(once, '2026-11-03')).toBe(once);
  });

  it('em novembro gera um previsto por ativo e não gera o do pausado', () => {
    const next = syncRecurring(data, '2026-11-03');
    const november = next.entries.filter(
      (e) => e.date.startsWith('2026-11') && !e.historical,
    );
    // 15 ativos, e o Aluguel de 10/11 já existia (geração antecipada).
    expect(november).toHaveLength(15);
    expect(november.some((e) => e.recurringId === 'r-seguro-res')).toBe(false);
    expect(november.filter((e) => e.recurringId === 'r-aluguel')).toHaveLength(1);
  });

  it('automático vira lançado na data; manual continua previsto (RN-11, RN-13)', () => {
    const next = syncRecurring(data, '2026-11-06');
    const entry = (id: string) => next.entries.find((e) => e.id === id);
    expect(entry('p-r-salario-2026-11')?.status).toBe('lancada'); // dia 5
    expect(entry('p-r-freela-2026-11')?.status).toBe('prevista'); // dia 12
    // Spotify de outubro, automático, venceu em 30/10.
    expect(entry('l-spotify')?.status).toBe('lancada');
    // Manual vencido de outubro segue previsto.
    expect(entry('l-gasto-livre')?.status).toBe('prevista');
  });

  it('dia 31 em novembro cai em 30/11', () => {
    const next = syncRecurring(data, '2026-11-03');
    expect(next.entries.find((e) => e.id === 'p-r-gasto-livre-2026-11')?.date).toBe(
      '2026-11-30',
    );
  });
});

describe('ativar e desativar (RN-14, CE-08)', () => {
  it('desativar remove os previstos pendentes do mês e os seguintes, e mantém os lançados', () => {
    const next = setRecurringActive(data, 'r-spotify', false, TODAY);
    expect(next.entries.some((e) => e.id === 'l-spotify')).toBe(false);
    expect(next.recurrings.find((r) => r.id === 'r-spotify')?.active).toBe(false);
    expect(next.entries.some((e) => e.id === 'l-netflix')).toBe(true);
  });

  it('desativar não toca nos lançados do próprio recorrente', () => {
    const next = setRecurringActive(data, 'r-netflix', false, TODAY);
    expect(next.entries.some((e) => e.id === 'l-netflix')).toBe(true);
  });

  it('reativar gera de novo o previsto do mês', () => {
    const off = setRecurringActive(data, 'r-spotify', false, TODAY);
    const on = setRecurringActive(off, 'r-spotify', true, TODAY);
    expect(on.entries.filter((e) => e.recurringId === 'r-spotify')).toHaveLength(1);
  });

  it('ligar o pausado gera o previsto do mês', () => {
    const next = setRecurringActive(data, 'r-seguro-res', true, TODAY);
    const generated = next.entries.find((e) => e.recurringId === 'r-seguro-res');
    expect(generated).toMatchObject({
      date: '2026-10-12',
      status: 'prevista',
      cents: 118000,
    });
  });
});

describe('editar e excluir (RN-15)', () => {
  const draft = (id: string) => draftOf(find(id));

  it('editar atualiza só os previstos pendentes', () => {
    const next = updateRecurring(
      data,
      'r-aluguel',
      { ...draft('r-aluguel'), value: '3.300,00' },
      TODAY,
    );
    expect(next.recurrings.find((r) => r.id === 'r-aluguel')?.cents).toBe(330000);
    expect(next.entries.find((e) => e.id === 'l-aluguel-nov')?.cents).toBe(330000);
    expect(next.entries.find((e) => e.id === 'l-aluguel')?.cents).toBe(320000);
  });

  it('o valor de "Lançar" não altera o cadastro: editar só mexe no que o usuário editou', () => {
    const next = updateRecurring(data, 'r-luz', draft('r-luz'), TODAY);
    expect(next.recurrings.find((r) => r.id === 'r-luz')).toEqual(find('r-luz'));
  });

  it('excluir remove os previstos pendentes e mantém os lançados', () => {
    const next = deleteRecurring(data, 'r-aluguel');
    expect(next.recurrings.some((r) => r.id === 'r-aluguel')).toBe(false);
    expect(next.entries.some((e) => e.id === 'l-aluguel-nov')).toBe(false);
    expect(next.entries.some((e) => e.id === 'l-aluguel')).toBe(true);
  });
});

describe('cadastro', () => {
  const valid = {
    ...draftOf(undefined),
    name: 'Pilates',
    categoryId: 'saude',
    sourceId: 'itau-visa',
    day: '8',
    value: '240,00',
  };

  it('cria e já gera o previsto do mês', () => {
    const next = addRecurring(data, valid, TODAY);
    const created = next.recurrings.find((r) => r.name === 'Pilates');
    expect(created).toMatchObject({
      id: 'r-pilates',
      day: 8,
      cents: 24000,
      active: true,
    });
    expect(next.entries.find((e) => e.recurringId === 'r-pilates')).toMatchObject({
      date: '2026-10-08',
      status: 'lancada', // automático e já vencido
    });
  });

  it('valida os campos', () => {
    expect(validateRecurring(data, valid)).toEqual({});
    expect(validateRecurring(data, { ...valid, name: ' ' })).toHaveProperty('name');
    expect(validateRecurring(data, { ...valid, day: '32' })).toHaveProperty('day');
    expect(validateRecurring(data, { ...valid, day: '0' })).toHaveProperty('day');
    expect(validateRecurring(data, { ...valid, value: '0,00' })).toHaveProperty('value');
    expect(validateRecurring(data, { ...valid, categoryId: 'salario' })).toHaveProperty(
      'categoryId',
    );
    expect(validateRecurring(data, { ...valid, sourceId: '' })).toHaveProperty(
      'sourceId',
    );
  });

  it('duas origens: distintas e a primeira cobre menos que o total', () => {
    const split = {
      ...valid,
      split: true,
      secondSourceId: 'itau-visa',
      coversUpTo: '100,00',
    };
    expect(validateRecurring(data, split)).toHaveProperty('secondSourceId');
    const ok = { ...split, secondSourceId: 'flex' };
    expect(validateRecurring(data, ok)).toEqual({});
    expect(validateRecurring(data, { ...ok, coversUpTo: '240,00' })).toHaveProperty(
      'coversUpTo',
    );
    expect(validateRecurring(data, { ...ok, coversUpTo: '' })).toHaveProperty(
      'coversUpTo',
    );
  });
});
