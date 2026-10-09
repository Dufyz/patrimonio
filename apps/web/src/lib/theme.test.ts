import { describe, expect, it } from 'vitest';

import type { Storageish } from './preferences.js';
import {
  DENSITY_KEY,
  THEME_KEY,
  applyThemeToDocument,
  readDensity,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
} from './theme.js';

const storageWith = (entries: Record<string, string>): Storageish => {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};

const throwingStorage: Storageish = {
  getItem: () => {
    throw new Error('armazenamento bloqueado');
  },
  setItem: () => {
    throw new Error('armazenamento bloqueado');
  },
  removeItem: () => {
    throw new Error('armazenamento bloqueado');
  },
};

describe('tema', () => {
  it('a preferência "sistema" segue o sistema', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('a preferência explícita ignora o sistema', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('o documento só conhece claro e escuro', () => {
    const root = { dataset: {} as DOMStringMap };
    applyThemeToDocument(root, resolveTheme('system', true), 'compact');
    expect(root.dataset['theme']).toBe('dark');
    expect(root.dataset['density']).toBe('compact');
  });

  it('preferência desconhecida cai no padrão em vez de propagar', () => {
    expect(readThemePreference(storageWith({ [THEME_KEY]: 'sepia' }))).toBe('system');
    expect(readDensity(storageWith({ [DENSITY_KEY]: '' }))).toBe('comfortable');
  });

  it('armazenamento bloqueado não derruba a leitura nem a escrita', () => {
    expect(readThemePreference(throwingStorage)).toBe('system');
    expect(() => writeThemePreference(throwingStorage, 'dark')).not.toThrow();
    expect(readThemePreference(null)).toBe('system');
  });

  it('a preferência gravada volta na sessão seguinte', () => {
    const storage = storageWith({});
    writeThemePreference(storage, 'dark');
    expect(readThemePreference(storage)).toBe('dark');
  });
});
