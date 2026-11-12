import { ApiError } from '../../api/client.js';
import type { RawSnapshot } from './snapshot.js';

/**
 * O cliente HTTP de Finanças. Toda escrita leva uma `Idempotency-Key`: repetir o
 * mesmo pedido (um duplo clique, uma nova tentativa) não grava duas vezes.
 */

type Body = Record<string, unknown>;

const call = async <T>(
  method: string,
  path: string,
  body?: Body,
  signal?: AbortSignal,
): Promise<T> => {
  const write = method !== 'GET';
  const response = await fetch(`/api/finance${path}`, {
    method,
    ...(signal === undefined ? {} : { signal }),
    headers: {
      'Content-Type': 'application/json',
      ...(write ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : `A api respondeu ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return parsed as T;
};

export type FinanceApi = {
  readonly snapshot: (signal?: AbortSignal) => Promise<RawSnapshot>;
  readonly sync: () => Promise<unknown>;
  readonly post: (path: string, body?: Body) => Promise<unknown>;
  readonly put: (path: string, body: Body) => Promise<unknown>;
  readonly del: (path: string) => Promise<unknown>;
};

export const financeApi: FinanceApi = {
  snapshot: (signal) => call<RawSnapshot>('GET', '/snapshot', undefined, signal),
  sync: () => call('POST', '/jobs/sync', {}),
  post: (path, body = {}) => call('POST', path, body),
  put: (path, body) => call('PUT', path, body),
  del: (path) => call('DELETE', path),
};
