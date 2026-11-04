import { describe, expect, it } from 'vitest';

import { queryEntries } from './ledger.js';
import { groupEntries } from './ledger_groups.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';
import { currentMonth } from '../lib/period.js';

const data = seedData();
const october = currentMonth(SEED_REFERENCE_DATE);
const entries = queryEntries(data, '', {});
const group = (grouping: Parameters<typeof groupEntries>[0]) =>
  groupEntries(grouping, entries, october, data.categories);

describe('por dia', () => {
  it('previstos primeiro e depois os dias, do mais novo ao mais antigo', () => {
    const groups = group('dia');
    expect(groups[0]?.kind).toBe('previstos');
    expect(groups[0]?.entries.map((e) => e.date)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-10-31',
      '2026-11-10',
    ]);
    const days = groups.slice(1).map((g) => g.date);
    expect(days).toEqual([...days].sort().reverse());
    expect(days[0]).toBe('2026-10-21');
    expect(days.at(-1)).toBe('2026-10-05');
  });
});

describe('por tipo', () => {
  const groups = group('tipo');

  it('duas seções, receitas primeiro', () => {
    expect(groups.map((g) => g.title)).toEqual(['Receitas', 'Despesas']);
  });

  it('receitas: 3 lançamentos e a soma das receitas', () => {
    expect(groups[0]?.entries).toHaveLength(3);
    expect(groups[0]?.summary).toEqual({ receitas: 1635000 });
  });

  it('despesas: conta previstos e soma lançadas e previstos (prancha 02B)', () => {
    expect(groups[1]?.entries).toHaveLength(13);
    expect(groups[1]?.summary).toEqual({ despesas: 947810, previsto: 1007190 });
  });

  it('dentro do grupo, previstos primeiro e lançados do mais novo ao mais antigo', () => {
    const list = groups[1]?.entries ?? [];
    expect(list.slice(0, 4).every((e) => e.status === 'prevista')).toBe(true);
    const posted = list.slice(4).map((e) => e.date);
    expect(posted).toEqual([...posted].sort().reverse());
  });
});

describe('por categoria', () => {
  const groups = group('categoria');

  it('despesas antes das receitas, só categorias com lançamentos', () => {
    const titles = groups.map((g) => g.title);
    expect(titles[0]).toBe('Moradia');
    expect(titles.indexOf('Reembolso')).toBeGreaterThan(titles.indexOf('Investimento'));
    expect(titles).not.toContain('Mercado');
  });

  it('o resumo traz lançado e previsto da categoria', () => {
    const assinaturas = groups.find((g) => g.title === 'Assinaturas');
    expect(assinaturas?.entries).toHaveLength(2);
    expect(assinaturas?.summary).toEqual({ despesas: 5590, previsto: 2190 });
    expect(groups.find((g) => g.title === 'Salário')?.summary).toEqual({
      receitas: 1420000,
    });
  });
});

describe('por conta', () => {
  const groups = group('conta');

  it('a despesa de duas origens aparece uma vez, no grupo da origem principal, com o total', () => {
    const withLuz = groups.filter((g) => g.entries.some((e) => e.id === 'l-luz'));
    expect(withLuz.map((g) => g.title)).toEqual(['Itaú Corrente']);
    expect(withLuz[0]?.entries.find((e) => e.id === 'l-luz')?.cents).toBe(31240);
  });

  it('compra no cartão fica na seção do cartão', () => {
    const visa = groups.find((g) => g.title === 'Itaú Visa');
    expect(visa?.entries.map((e) => e.id).sort()).toEqual([
      'l-academia',
      'l-netflix',
      'l-spotify',
    ]);
    expect(visa?.summary).toEqual({ despesas: 15980, previsto: 2190 });
  });

  it('o resumo traz receitas, despesas e previsto', () => {
    const itau = groups.find((g) => g.title === 'Itaú Corrente');
    expect(itau?.summary.receitas).toBe(1635000);
    expect(itau?.summary.previsto).toBeDefined();
  });
});
