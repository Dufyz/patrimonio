import { describe, expect, it } from 'vitest';

import type { Storageish } from './preferences.js';
import {
  assertNotPersistable,
  readGrouping,
  readLastScreen,
  writeGrouping,
  writeLastScreen,
} from './view_preferences.js';

const memory = (): Storageish => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

describe('preferências de visualização por aparelho (CMP-13)', () => {
  it('lembra o último agrupamento de cada tela, separadamente', () => {
    const storage = memory();
    writeGrouping('posicoes', 'categoria', storage);
    writeGrouping('lancamentos', 'tipo', storage);

    expect(readGrouping('posicoes', ['classe', 'categoria'], 'classe', storage)).toBe(
      'categoria',
    );
    expect(readGrouping('lancamentos', ['dia', 'tipo'], 'dia', storage)).toBe('tipo');
  });

  it('valor que a tela não conhece cai no padrão', () => {
    const storage = memory();
    writeGrouping('posicoes', 'lixo', storage);

    expect(readGrouping('posicoes', ['classe', 'categoria'], 'classe', storage)).toBe(
      'classe',
    );
  });

  it('lembra a última tela por escopo', () => {
    const storage = memory();
    writeLastScreen('todas', 'lancamentos', storage);
    writeLastScreen('carteira-1', 'estrategia', storage);

    expect(readLastScreen('todas', storage)).toBe('lancamentos');
    expect(readLastScreen('carteira-1', storage)).toBe('estrategia');
    expect(readLastScreen('carteira-2', storage)).toBeNull();
  });

  it('armazenamento indisponível devolve os padrões e não lança', () => {
    expect(readGrouping('posicoes', ['classe'], 'classe', null)).toBe('classe');
    expect(readLastScreen('todas', null)).toBeNull();
    expect(() => writeGrouping('posicoes', 'classe', null)).not.toThrow();

    const broken: Storageish = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => undefined,
    };
    expect(readGrouping('posicoes', ['classe'], 'classe', broken)).toBe('classe');
    expect(() => writeLastScreen('todas', 'x', broken)).not.toThrow();
  });

  it('período e filtros não persistem', () => {
    expect(() => assertNotPersistable('patrimonio.period')).toThrow();
    expect(() => assertNotPersistable('patrimonio.filtros.posicoes')).toThrow();
    expect(() => assertNotPersistable('patrimonio.grouping.posicoes')).not.toThrow();
  });
});
