import { describe, expect, it } from 'vitest';

import {
  DISPLAY_DEFAULTS,
  defaultRange,
  formatFullDate,
  homePath,
  readDisplay,
  writeDisplay,
} from './display_preferences.js';
import type { IsoDate } from '../finance/lib/dates.js';

const memory = (): Storage => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as Storage;
};

const TODAY = '2026-10-24' as IsoDate;

describe('Exibição: preferências (CFG-02)', () => {
  it('sem nada guardado vale o padrão; armazenamento indisponível também', () => {
    expect(readDisplay(memory())).toEqual(DISPLAY_DEFAULTS);
    expect(readDisplay(null)).toEqual(DISPLAY_DEFAULTS);
  });

  it('cada escolha persiste e valor inválido volta ao padrão', () => {
    const storage = memory();
    writeDisplay('homeScope', 'fluxo', storage);
    writeDisplay('dateFormat', 'iso', storage);
    expect(readDisplay(storage).homeScope).toBe('fluxo');
    expect(readDisplay(storage).dateFormat).toBe('iso');
    storage.setItem('patrimonio.display.weekStart', 'quarta');
    expect(readDisplay(storage).weekStart).toBe('domingo');
  });

  it('o período padrão vira o intervalo em que as telas abrem', () => {
    expect(defaultRange('mes-corrente', TODAY)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(defaultRange('mes-anterior', TODAY)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(defaultRange('ultimos-12-meses', TODAY)).toEqual({
      from: '2025-11-01',
      to: '2026-10-31',
    });
    expect(defaultRange('ano-ate-hoje', TODAY)).toEqual({
      from: '2026-01-01',
      to: '2026-10-24',
    });
  });

  it('a tela inicial tem caminho e a data aceita os dois formatos', () => {
    expect(homePath('visao-geral')).toBe('/');
    expect(homePath('lancamentos')).toBe('/lancamentos');
    expect(formatFullDate('2026-10-05', 'br')).toBe('05/10/2026');
    expect(formatFullDate('2026-10-05', 'iso')).toBe('2026-10-05');
  });
});
