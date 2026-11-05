import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

import { browserStorage, readRaw, writeRaw } from '../../lib/preferences.js';
import type { Storageish } from '../../lib/preferences.js';
import { financeApi } from '../api/finance_api.js';
import type { FinanceApi } from '../api/finance_api.js';
import { EMPTY_DATA, snapshotToData } from '../api/snapshot.js';
import type { RawSnapshot } from '../api/snapshot.js';
import { SEED_VERSION, seedData } from '../domain/seed.js';
import type { FinanceData } from '../domain/types.js';
import type { Command } from './commands.js';

/**
 * A store de Finanças.
 *
 * Há duas, com a mesma forma. A **remota** (a do app) lê a foto de
 * `GET /finance/snapshot` e cada ação vira chamadas à API, seguidas de uma nova
 * leitura: o servidor é o dono do dado. A **local** guarda no `localStorage`
 * (uma chave versionada, partindo da semente das pranchas) e serve aos testes.
 * As telas só leem `useFinanceData` e chamam `run(comando)`.
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
    Array.isArray(data['cards']) &&
    Array.isArray(data['cardItems']) &&
    Array.isArray(data['payments']) &&
    Array.isArray(data['accounts']) &&
    Array.isArray(data['movements']) &&
    Array.isArray(data['categories']) &&
    Array.isArray(data['recurrings']) &&
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

/** `loading` só antes da primeira foto; depois disso a tela fica no ar e `busy` marca uma escrita em curso. */
export type StoreStatus = {
  readonly phase: 'loading' | 'ready' | 'error';
  readonly busy: boolean;
  /** A última falha, de leitura ou de escrita, até ser dispensada. */
  readonly error: string | null;
};

export type FinanceStore = {
  readonly get: () => FinanceData;
  readonly set: (update: (data: FinanceData) => FinanceData) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly reset: () => void;
  /** Executa uma ação das telas. Devolve `false` quando falhou (a causa fica em `status().error`). */
  readonly run: (command: Command) => Promise<boolean>;
  readonly status: () => StoreStatus;
  /** Remota: lê de novo a foto. Local: não faz nada. */
  readonly start: () => void;
  readonly dismissError: () => void;
  readonly remote: boolean;
};

const READY: StoreStatus = { phase: 'ready', busy: false, error: null };

export const createFinanceStore = (
  storage: Storageish | null = browserStorage(),
): FinanceStore => {
  let data = load(storage);
  const listeners = new Set<() => void>();

  const commit = (next: FinanceData): void => {
    if (next === data) return;
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
    run: (command) => {
      commit(command.local(data));
      return Promise.resolve(true);
    },
    status: () => READY,
    start: () => undefined,
    dismissError: () => undefined,
    remote: false,
  };
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Algo deu errado.';

/**
 * A store do app. As escritas entram numa fila (uma de cada vez, na ordem em que
 * o usuário as fez) e cada uma termina relendo a foto. Se uma falha, a foto é
 * relida do mesmo jeito, para a tela voltar ao que o servidor tem de fato.
 */
export const createRemoteFinanceStore = (api: FinanceApi = financeApi): FinanceStore => {
  let data: FinanceData = EMPTY_DATA;
  let raw: RawSnapshot | null = null;
  let status: StoreStatus = { phase: 'loading', busy: false, error: null };
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  const setStatus = (next: Partial<StoreStatus>): void => {
    status = { ...status, ...next };
    emit();
  };
  const read = async (): Promise<void> => {
    const snapshot = await api.snapshot();
    raw = snapshot;
    data = snapshotToData(snapshot);
  };

  const start = (): void => {
    setStatus({ phase: 'loading', error: null });
    // A rotina diária também roda ao abrir: gera o previsto do mês
    // (RN-10, RN-11). É idempotente.
    void api
      .sync()
      .catch(() => undefined)
      .then(read)
      .then(
        () => setStatus({ phase: 'ready', error: null }),
        (error: unknown) => setStatus({ phase: 'error', error: messageOf(error) }),
      );
  };

  return {
    get: () => data,
    set: () => undefined,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => undefined,
    run: (command) => {
      const job = queue.then(async (): Promise<boolean> => {
        if (raw === null) return false;
        setStatus({ busy: true, error: null });
        let failure: string | null = null;
        try {
          await command.remote({ api, data, raw });
        } catch (error) {
          failure = messageOf(error);
        }
        try {
          await read();
        } catch (error) {
          failure ??= messageOf(error);
        }
        setStatus({ busy: false, error: failure });
        return failure === null;
      });
      queue = job;
      return job;
    },
    status: () => status,
    start,
    dismissError: () => setStatus({ error: null }),
    remote: true,
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

export const useFinanceStatus = (): StoreStatus => {
  const store = useFinanceStore();
  return useSyncExternalStore(store.subscribe, store.status);
};

export const useFinanceData = (): FinanceData => {
  const store = useFinanceStore();
  return useSyncExternalStore(store.subscribe, store.get);
};
