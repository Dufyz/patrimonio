import { request } from './client.js';

/**
 * Receitas × despesas: `GET /api/finance/flow-series`. Os meses vêm do mesmo
 * livro da cascata do mês, com os aportes e o previsto do mês corrente.
 */
export type FlowSeriesMonth = {
  readonly month: string;
  readonly receitas: string;
  readonly despesas: string;
  readonly aportes: string;
  readonly projetado: {
    readonly receitas: string;
    readonly despesas: string;
    readonly aportes: string;
  };
};

export type FlowSeriesResource = { readonly months: readonly FlowSeriesMonth[] };

export const fetchFlowSeries = (
  query: { readonly month: string; readonly count?: number },
  signal?: AbortSignal,
): Promise<FlowSeriesResource> =>
  request(
    `/api/finance/flow-series?month=${query.month}&count=${query.count ?? 12}`,
    {
      parse: (value: unknown) => {
        const body = value as Partial<FlowSeriesResource> | null;
        if (!Array.isArray(body?.months)) throw new Error('Resposta de série inválida.');
        return body as FlowSeriesResource;
      },
    },
    signal === undefined ? {} : { signal },
  );
