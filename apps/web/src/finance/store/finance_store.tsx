import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

import { browserStorage, readRaw, writeRaw } from '../../lib/preferences.js';
import type { Storageish } from '../../lib/preferences.js';
import { SEED_VERSION, seedData } from '../domain/seed.js';
import type { FinanceData } from '../domain/types.js';

/**
 * A store de Finanças.
 *
 * Os dados vivem no navegador (`localStorage`, uma chave versionada) e partem da
 * semente das pranchas. É a única fronteira de persistência: trocar por uma API
 * é trocar este arquivo, porque as telas só leem `useFinanceData` e chamam as
 * ações. Dados ilegíveis ou de outra versão da semente caem na semente.
 */

export const DATA_KEY = 'patrimonio.finance.data';

type Stored = { readonly version: number; readonly data: FinanceData };

const isStored = (value: unknown): value is Stored => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const data = record['data'] as Record<string, unknown> | undefined;
  return (
    record['version'] === SEED_VERSION &&
    typeof data === 'object' &&
    data !== null &&
    Array.isArray(data['categories']) &&
    Array.isArray(data['entries'])
  );
};

const load = (storage: Storageish | null): FinanceData => {
  const raw = readRaw(storage, DATA_KEY);
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isStored(parsed)) return parsed.data;
    } catch {
      // cai na semente
    }
  }
  return seedData();
};

export type FinanceStore = {
  readonly get: () => FinanceData;
  readonly set: (update: (data: FinanceData) => FinanceData) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly reset: () => void;
};

export const createFinanceStore = (
  storage: Storageish | null = browserStorage(),
): FinanceStore => {
  let data = load(storage);
  const listeners = new Set<() => void>();

  const commit = (next: FinanceData): void => {
    data = next;
    writeRaw(storage, DATA_KEY, JSON.stringify({ version: SEED_VERSION, data }));
    for (const listener of listeners) listener();
  };

  return {
    get: () => data,
    set: (update) => commit(update(data)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => commit(seedData()),
  };
};

const StoreContext = createContext<FinanceStore | null>(null);

export const FinanceStoreProvider = ({
  store,
  children,
}: {
  readonly store?: FinanceStore | undefined;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const value = useMemo(() => store ?? createFinanceStore(), [store]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export const useFinanceStore = (): FinanceStore => {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error('useFinanceStore precisa de um FinanceStoreProvider acima.');
  }
  return store;
};

export const useFinanceData = (): FinanceData => {
  const store = useFinanceStore();
  return useSyncExternalStore(store.subscribe, store.get);
};
