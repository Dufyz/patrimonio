import type { RecurringKind, RecurringResource } from '../lib/recurring_view.js';
import { request } from './client.js';

/** REC-01/03 · Recorrentes do servidor: lista, criação, edição, pausa, pulo e exclusão. */
export type RecurringRequest = {
  readonly name: string;
  readonly kind: RecurringKind;
  readonly category_id: string | null;
  readonly portfolio_id: string | null;
  readonly asset_id: string | null;
  readonly source: { readonly type: 'conta' | 'cartao'; readonly id: string };
  readonly second_source: {
    readonly type: 'conta' | 'cartao';
    readonly id: string;
  } | null;
  readonly covers_up_to: string | null;
  readonly day: number;
  readonly mode: 'manual' | 'automatico';
  readonly amount: string;
  readonly active?: boolean;
};

const raw = { parse: (value: unknown) => value };

export const fetchRecurrings = (
  signal?: AbortSignal,
): Promise<readonly RecurringResource[]> =>
  request(
    '/api/finance/recurrings',
    {
      parse: (value: unknown) => {
        const list = (value as { recurrings?: unknown } | null)?.recurrings;
        if (!Array.isArray(list)) throw new Error('Resposta de recorrentes inválida.');
        return list as readonly RecurringResource[];
      },
    },
    signal === undefined ? {} : { signal },
  );

const write = (
  method: string,
  path: string,
  key: string,
  body?: unknown,
): Promise<unknown> =>
  request(path, raw, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'Idempotency-Key': key },
  });

export const createRecurring = (body: RecurringRequest, key: string): Promise<unknown> =>
  write('POST', '/api/finance/recurrings', key, body);

export const updateRecurring = (
  id: string,
  body: RecurringRequest,
  key: string,
): Promise<unknown> => write('PUT', `/api/finance/recurrings/${id}`, key, body);

export const setRecurringActive = (
  id: string,
  active: boolean,
  key: string,
): Promise<unknown> =>
  write('POST', `/api/finance/recurrings/${id}/active`, key, { active });

export const skipRecurringMonth = (
  id: string,
  month: string,
  key: string,
): Promise<unknown> =>
  write('POST', `/api/finance/recurrings/${id}/skip`, key, { month });

export const deleteRecurring = (id: string, key: string): Promise<unknown> =>
  write('DELETE', `/api/finance/recurrings/${id}`, key);

/** As categorias de Finanças (não as classes de ativo). */
export type FinanceCategoryResource = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'receita' | 'despesa';
  readonly color: string;
  readonly nature?: 'fixa' | 'livre' | null | undefined;
  readonly archived: boolean;
};

export const fetchFinanceCategories = (
  signal?: AbortSignal,
): Promise<readonly FinanceCategoryResource[]> =>
  request(
    '/api/finance/categories',
    {
      parse: (value: unknown) => {
        const list = (value as { categories?: unknown } | null)?.categories;
        if (!Array.isArray(list)) throw new Error('Resposta de categorias inválida.');
        return list as readonly FinanceCategoryResource[];
      },
    },
    signal === undefined ? {} : { signal },
  );
