import { request } from './client.js';

/**
 * VGR-10 · Despesas (ou receitas) por categoria no período, lançadas: a soma
 * das linhas é o total do período, e os percentuais, em décimos, somam 1000.
 */
export type CategoryBreakdownResource = {
  readonly total: string;
  readonly count: number;
  readonly rows: readonly {
    readonly category_id: string;
    readonly name: string;
    readonly color: string;
    readonly amount: string;
    readonly count: number;
    readonly tenths: number;
  }[];
};

export const fetchCategoryBreakdown = (
  query: {
    readonly kind?: 'receita' | 'despesa';
    readonly from: string;
    readonly to: string;
  },
  signal?: AbortSignal,
): Promise<CategoryBreakdownResource> =>
  request(
    `/api/finance/categories/breakdown?kind=${query.kind ?? 'despesa'}&from=${query.from}&to=${query.to}`,
    {
      parse: (value: unknown) => {
        const body = value as Partial<CategoryBreakdownResource> | null;
        if (
          body === null ||
          !Array.isArray(body.rows) ||
          typeof body.total !== 'string'
        ) {
          throw new Error('Resposta de categorias inválida.');
        }
        return body as CategoryBreakdownResource;
      },
    },
    signal === undefined ? {} : { signal },
  );
