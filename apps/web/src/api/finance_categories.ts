import { request } from './client.js';

/** CAT-01/03 · Uso das categorias no período e escrita (criar, editar, excluir com destino). */
export type CategoryUsageResource = {
  readonly range: { readonly from: string; readonly to: string };
  readonly rows: readonly {
    readonly category_id: string;
    readonly posted: string;
    readonly planned: string;
    readonly entries_total: number;
  }[];
  readonly totals: {
    readonly receita: { readonly posted: string; readonly planned: string };
    readonly despesa: { readonly posted: string; readonly planned: string };
  };
};

export type CategoryRequest = {
  readonly name: string;
  readonly kind: 'receita' | 'despesa';
  readonly color: string;
  readonly nature: 'fixa' | 'livre' | null;
};

const raw = { parse: (value: unknown) => value };

export const fetchCategoryUsage = (
  query: { readonly from: string; readonly to: string },
  signal?: AbortSignal,
): Promise<CategoryUsageResource> =>
  request(
    `/api/finance/categories/usage?from=${query.from}&to=${query.to}`,
    {
      parse: (value: unknown) => {
        const body = value as Partial<CategoryUsageResource> | null;
        if (body === null || !Array.isArray(body.rows) || body.totals === undefined) {
          throw new Error('Resposta de uso das categorias inválida.');
        }
        return body as CategoryUsageResource;
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

export const createFinanceCategory = (
  body: CategoryRequest,
  key: string,
): Promise<unknown> => write('POST', '/api/finance/categories', key, body);

export const updateFinanceCategory = (
  id: string,
  body: CategoryRequest,
  key: string,
): Promise<unknown> => write('PUT', `/api/finance/categories/${id}`, key, body);

export const deleteFinanceCategory = (id: string, key: string): Promise<unknown> =>
  write('DELETE', `/api/finance/categories/${id}`, key);

/** Exclusão com destino: move lançamentos e recorrentes e remove, numa transação. */
export const deleteFinanceCategoryMoving = (
  id: string,
  moveTo: string,
  key: string,
): Promise<unknown> =>
  write('POST', `/api/finance/categories/${id}/delete`, key, { move_to: moveTo });
