import type { CategoryResource } from '@patrimonio/contracts';

import { request } from './client.js';
import type { Parser } from './client.js';

/**
 * Os cadastros que a pessoa mantém: carteira, instituição, categoria e ativo.
 *
 * Todas as escritas respondem com o recurso gravado e uma mensagem; a tela não
 * precisa do recurso (ela relê Configurações), só do erro quando a `api` recusa
 * — e a recusa vem com a razão em português, que é o que o modal mostra.
 */

const accept: Parser<unknown> = { parse: (value) => value };

const send = async (
  method: 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  body?: unknown,
): Promise<unknown> =>
  request(path, accept, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export type PortfolioBody = {
  readonly name: string;
};

export const createPortfolio = (body: PortfolioBody): Promise<unknown> =>
  send('POST', '/api/portfolios', body);

export const updatePortfolio = (
  id: string,
  body: Partial<PortfolioBody>,
): Promise<unknown> => send('PATCH', `/api/portfolios/${id}`, body);

export type DeletePortfolioBody = {
  readonly confirm_name: string;
  readonly transactions: 'move' | 'delete';
  readonly destination_portfolio_id?: string;
};

export const deletePortfolio = (
  id: string,
  body: DeletePortfolioBody,
): Promise<unknown> => send('DELETE', `/api/portfolios/${id}`, body);

const categoriesParser: Parser<readonly CategoryResource[]> = {
  parse: (value) => {
    const items =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)['categories']
        : undefined;
    if (!Array.isArray(items))
      throw new Error('A api respondeu a lista fora do contrato');
    return items as CategoryResource[];
  },
};

export const fetchCategories = (
  signal?: AbortSignal,
): Promise<readonly CategoryResource[]> =>
  request('/api/categories', categoriesParser, signal === undefined ? {} : { signal });

export type AssetPatch = {
  readonly ticker?: string;
  readonly name?: string;
  readonly category_id?: string | null;
  readonly sector?: string | null;
};

export const updateAsset = (id: string, body: AssetPatch): Promise<unknown> =>
  send('PATCH', `/api/assets/${id}`, body);

export const archiveAsset = (id: string, archived: boolean): Promise<unknown> =>
  send('POST', `/api/assets/${id}/archive`, { archived });

export const deleteAsset = (id: string): Promise<unknown> =>
  send('DELETE', `/api/assets/${id}`);
