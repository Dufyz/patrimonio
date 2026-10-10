import { statementResourceSchema } from '@patrimonio/contracts';
import type { StatementGroup, StatementResource } from '@patrimonio/contracts';

import { request } from './client.js';

/**
 * T-04 · O extrato do recorte.
 *
 * Todo filtro vai para a `api`, pela mesma razão de Posições: o subtotal do mês
 * e a contagem de cada pastilha descrevem o recorte inteiro, e filtrar aqui os
 * faria descrever só o que a página trouxe.
 */
export type StatementRequest = {
  readonly portfolioId: string;
  readonly institutionId: string | null;
  readonly group: StatementGroup | null;
  readonly search: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly page: number;
  readonly limit: number;
};

export const statementQuery = (input: StatementRequest): URLSearchParams => {
  const params = new URLSearchParams();

  params.set('portfolio_id', input.portfolioId);
  if (input.institutionId !== null) params.set('institution_id', input.institutionId);
  if (input.group !== null) params.set('group', input.group);
  if (input.search.trim() !== '') params.set('search', input.search.trim());
  if (input.from !== null) params.set('from', input.from);
  if (input.to !== null) params.set('to', input.to);
  params.set('page', String(input.page));
  params.set('limit', String(input.limit));

  return params;
};

export const fetchStatement = async (
  input: StatementRequest,
  signal?: AbortSignal,
): Promise<StatementResource> =>
  request(`/api/statement?${statementQuery(input).toString()}`, statementResourceSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
