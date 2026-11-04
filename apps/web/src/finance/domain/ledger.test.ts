import { describe, expect, it } from 'vitest';

import { indicators, primarySourceId, queryEntries } from './ledger.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';
import { currentMonth } from '../lib/period.js';

const data = seedData();
const october = currentMonth(SEED_REFERENCE_DATE);

describe('indicadores de outubro (prancha 02A)', () => {
  const entries = queryEntries(data, '', {});
  const result = indicators(entries, october);

  it('receitas e despesas só dos lançados do período', () => {
    expect(result.receitas).toEqual({ cents: 1635000, count: 3 });
    expect(result.despesas).toEqual({ cents: 947810, count: 9 });
  });

  it('saldo é receitas menos despesas lançadas', () => {
    expect(result.saldo).toBe(687190);
  });

  it('ainda a lançar soma os previstos até o fim do período', () => {
    // Spotify, Gasto livre e Investimento; o aluguel de 10/11 fica de fora.
    expect(result.aLancar).toEqual({ cents: 687190, count: 3 });
  });

  it('o histórico nunca entra', () => {
    expect(entries.some((entry) => entry.historical === true)).toBe(false);
  });
});

describe('período e filtros mudam a faixa', () => {
  it('outro período recalcula', () => {
    const september = { from: '2026-09-01', to: '2026-09-30' };
    const result = indicators(queryEntries(data, '', {}), september);
    expect(result.receitas.count).toBe(0);
    expect(result.aLancar.count).toBe(0); // previstos além do fim do período ficam de fora
    const november = indicators(queryEntries(data, '', {}), {
      from: '2026-10-01',
      to: '2026-11-30',
    });
    expect(november.aLancar.count).toBe(4);
  });

  it('o filtro de tipo restringe a faixa', () => {
    const entries = queryEntries(data, '', { tipo: ['receita'] });
    const result = indicators(entries, october);
    expect(result.despesas.count).toBe(0);
    expect(result.aLancar.count).toBe(0);
    expect(result.saldo).toBe(1635000);
  });

  it('a busca acha por conta e por categoria', () => {
    expect(queryEntries(data, 'flex', {}).map((e) => e.id)).toEqual(['l-luz']);
    expect(queryEntries(data, 'freelas', {}).map((e) => e.id)).toEqual(['l-freela']);
  });

  it('filtrar por conta olha todas as origens do lançamento', () => {
    const ids = queryEntries(data, '', { conta: ['flex'] }).map((e) => e.id);
    expect(ids).toEqual(['l-luz']);
  });

  it('filtrar por situação previsto', () => {
    expect(queryEntries(data, '', { situacao: ['prevista'] })).toHaveLength(4);
  });
});

describe('origem principal (RN-23)', () => {
  it('é a de maior parte', () => {
    const luz = data.entries.find((e) => e.id === 'l-luz');
    expect(luz && primarySourceId(luz)).toBe('itau-corrente');
  });
  it('no empate, a primeira informada', () => {
    expect(
      primarySourceId({
        ...data.entries[0]!,
        payments: [
          { sourceId: 'a', cents: 10 },
          { sourceId: 'b', cents: 10 },
        ],
      }),
    ).toBe('a');
  });
});
