import { describe, expect, it } from 'vitest';

import {
  NAME_REQUIRED,
  NAME_TAKEN,
  addCategory,
  canChangeKind,
  deleteCategory,
  replacementOptions,
  updateCategory,
  validateCategory,
} from './category_ops.js';
import { seedData } from './seed.js';

const data = seedData();

describe('validação (RN-60)', () => {
  it('pede nome', () => {
    expect(
      validateCategory(data, { name: '  ', kind: 'despesa', color: 'blue' }),
    ).toEqual({
      name: NAME_REQUIRED,
    });
  });

  it('o nome é único dentro do tipo, sem distinguir caixa e acento', () => {
    expect(
      validateCategory(data, { name: 'saude', kind: 'despesa', color: 'blue' }),
    ).toEqual({ name: NAME_TAKEN });
  });

  it('o mesmo nome em outro tipo é permitido', () => {
    expect(
      validateCategory(data, { name: 'Saúde', kind: 'receita', color: 'blue' }),
    ).toEqual({});
  });

  it('editar a própria categoria não conta como duplicata', () => {
    expect(
      validateCategory(data, { name: 'Saúde', kind: 'despesa', color: 'blue' }, 'saude'),
    ).toEqual({});
  });

  it('a cor vem da paleta', () => {
    expect(
      validateCategory(data, { name: 'Pets', kind: 'despesa', color: '#ff0000' }),
    ).toHaveProperty('color');
  });
});

describe('criar e editar', () => {
  it('cria com identificador próprio e preserva a ordem', () => {
    const next = addCategory(data, { name: ' Pets ', kind: 'despesa', color: 'olive' });
    expect(next.categories.at(-1)).toEqual({
      id: 'pets',
      name: 'Pets',
      kind: 'despesa',
      color: 'olive',
    });
    expect(next.categories).toHaveLength(16);
  });

  it('não cria categoria inválida', () => {
    expect(addCategory(data, { name: '', kind: 'despesa', color: 'olive' })).toBe(data);
  });

  it('editar a cor mantém os lançamentos', () => {
    const next = updateCategory(data, 'moradia', {
      name: 'Moradia',
      kind: 'despesa',
      color: 'teal',
    });
    expect(next.categories.find((c) => c.id === 'moradia')?.color).toBe('teal');
    expect(next.entries).toBe(data.entries);
  });

  it('o tipo só muda sem lançamentos', () => {
    expect(canChangeKind(data, 'moradia')).toBe(false);
    const next = updateCategory(data, 'moradia', {
      name: 'Moradia',
      kind: 'receita',
      color: 'slate',
    });
    expect(next.categories.find((c) => c.id === 'moradia')?.kind).toBe('despesa');

    const fresh = addCategory(data, { name: 'Pets', kind: 'despesa', color: 'olive' });
    expect(canChangeKind(fresh, 'pets')).toBe(true);
    const moved = updateCategory(fresh, 'pets', {
      name: 'Pets',
      kind: 'receita',
      color: 'olive',
    });
    expect(moved.categories.find((c) => c.id === 'pets')?.kind).toBe('receita');
  });
});

describe('excluir (RN-61)', () => {
  it('categoria sem uso sai direto', () => {
    const fresh = addCategory(data, { name: 'Pets', kind: 'despesa', color: 'olive' });
    const next = deleteCategory(fresh, 'pets', null);
    expect(next.categories.some((c) => c.id === 'pets')).toBe(false);
  });

  it('categoria em uso exige destino', () => {
    expect(deleteCategory(data, 'moradia', null)).toBe(data);
  });

  it('o destino é do mesmo tipo e outra categoria', () => {
    const ids = replacementOptions(data, 'moradia').map((c) => c.id);
    expect(ids).not.toContain('moradia');
    expect(ids).not.toContain('salario');
    expect(ids).toContain('saude');
    expect(deleteCategory(data, 'moradia', 'salario')).toBe(data);
  });

  it('move os lançamentos para o destino', () => {
    const next = deleteCategory(data, 'moradia', 'saude');
    expect(next.categories.some((c) => c.id === 'moradia')).toBe(false);
    expect(next.entries.some((e) => e.categoryId === 'moradia')).toBe(false);
    const luz = next.entries.find((e) => e.id === 'l-luz');
    expect(luz?.categoryId).toBe('saude');
    expect(next.entries).toHaveLength(data.entries.length);
  });

  it('os recorrentes também passam para o destino (CE-09)', () => {
    const next = deleteCategory(data, 'moradia', 'mercado');
    expect(next.recurrings.some((r) => r.categoryId === 'moradia')).toBe(false);
    expect(next.recurrings.find((r) => r.id === 'r-aluguel')?.categoryId).toBe('mercado');
    expect(next.entries.find((e) => e.id === 'l-luz')?.categoryId).toBe('mercado');
  });

  it('categoria só com recorrente também exige destino', () => {
    const fresh = addCategory(data, { name: 'Pets', kind: 'despesa', color: 'olive' });
    const withRecurring = {
      ...fresh,
      recurrings: [
        ...fresh.recurrings,
        { ...fresh.recurrings[0]!, categoryId: 'pets', kind: 'despesa' as const },
      ],
    };
    expect(deleteCategory(withRecurring, 'pets', null)).toBe(withRecurring);
  });
});
