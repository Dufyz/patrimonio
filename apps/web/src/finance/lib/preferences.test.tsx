import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Amount } from '../components/amount.js';
import { PreferencesProvider } from '../../components/preferences.js';
import { browserStorage } from '../../lib/preferences.js';
import { columnsKey, readHiddenColumns, writeHiddenColumns } from './columns.js';
import {
  DEFAULT_GROUPING,
  GROUPING_KEY,
  readEntryGrouping,
  writeEntryGrouping,
} from './preferences.js';
import { currentMonth } from './period.js';

const memory = () => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
};

afterEach(() => vi.restoreAllMocks());

describe('preferências persistentes de Finanças', () => {
  it('o último agrupamento de Lançamentos volta na próxima abertura', () => {
    const storage = memory();
    expect(readEntryGrouping(storage)).toBe(DEFAULT_GROUPING);
    writeEntryGrouping(storage, 'categoria');
    expect(storage.store.get(GROUPING_KEY)).toBe('categoria');
    expect(readEntryGrouping(storage)).toBe('categoria');
  });

  it('valor gravado por versão anterior ou lixo cai no padrão', () => {
    const storage = memory();
    storage.setItem(GROUPING_KEY, 'semana');
    expect(readEntryGrouping(storage)).toBe('dia');
  });

  it('as colunas visíveis persistem por tela', () => {
    const storage = memory();
    const columns = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ];
    writeHiddenColumns(storage, 'lancamentos', ['b']);
    expect(storage.store.has(columnsKey('lancamentos'))).toBe(true);
    expect(readHiddenColumns(storage, 'lancamentos', columns)).toEqual(['b']);
    expect(readHiddenColumns(storage, 'contas', columns)).toEqual([]);
  });

  it('período e filtros não têm chave de armazenamento: o período abre no mês corrente', () => {
    const storage = memory();
    writeEntryGrouping(storage, 'tipo');
    const keys = [...storage.store.keys()];
    expect(keys.some((key) => /periodo|period|filtro|filter/i.test(key))).toBe(false);
    expect(currentMonth('2026-10-24')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('ocultar valores ligado mascara já na primeira renderização', () => {
    const storage = memory();
    storage.setItem('patrimonio.hidden_values', 'true');
    const html = renderToString(
      <PreferencesProvider storage={storage}>
        <Amount cents={1177315} />
      </PreferencesProvider>,
    );
    expect(html).toContain('•••••');
    expect(html).not.toContain('11.773');
  });

  it('sem armazenamento, o app usa os padrões', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const storage = browserStorage();
    expect(storage).toBeNull();
    expect(readEntryGrouping(storage)).toBe('dia');
    expect(() => writeEntryGrouping(storage, 'conta')).not.toThrow();

    const html = renderToString(
      <PreferencesProvider storage={storage}>
        <Amount cents={1177315} />
      </PreferencesProvider>,
    );
    expect(html).toContain('11.773,15');
  });
});
