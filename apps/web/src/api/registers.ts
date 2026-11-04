import type { AssetResource, CategoryResource } from '@patrimonio/contracts';

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

export type CategoryBody = {
  readonly name: string;
  readonly color_token: string;
  /** Ausente cria uma classe; presente, uma categoria dentro da classe. */
  readonly parent_id?: string | null;
};

export const createCategory = (body: CategoryBody): Promise<unknown> =>
  send('POST', '/api/categories', body);

/** Renomear, recolorir ou mover (`parent_id`) a categoria. O id não muda. */
export const updateCategory = (
  id: string,
  body: Partial<CategoryBody>,
): Promise<unknown> => send('PATCH', `/api/categories/${id}`, body);

export const deleteCategory = (id: string): Promise<unknown> =>
  send('DELETE', `/api/categories/${id}`);

export type AssetPatch = {
  readonly ticker?: string;
  readonly name?: string;
  readonly category_id?: string | null;
  readonly sector?: string | null;
  readonly issuer_id?: string | null;
  readonly indexer?: FixedIncomeBody['indexer'] | null;
  readonly rate?: string | null;
  readonly issued_at?: string | null;
  readonly maturity_date?: string | null;
  readonly liquidity?: FixedIncomeBody['liquidity'] | null;
  readonly liquidity_days?: number | null;
  readonly tax_regime?: FixedIncomeBody['tax_regime'] | null;
  readonly redemption_rule?: FixedIncomeBody['redemption_rule'] | null;
  readonly lot_term_months?: number | null;
};

export const updateAsset = (id: string, body: AssetPatch): Promise<unknown> =>
  send('PATCH', `/api/assets/${id}`, body);

export const archiveAsset = (id: string, archived: boolean): Promise<unknown> =>
  send('POST', `/api/assets/${id}/archive`, { archived });

export const deleteAsset = (id: string): Promise<unknown> =>
  send('DELETE', `/api/assets/${id}`);

export type FixedIncomeBody = {
  readonly origin: 'manual';
  readonly kind: 'cdb' | 'lci' | 'lca' | 'cri' | 'cra' | 'debenture' | 'outro';
  readonly issuer_id: string;
  readonly indexer: 'cdi_pct' | 'ipca_plus' | 'prefixed' | 'selic_plus';
  readonly rate: string;
  readonly issued_at: string;
  /** Ausente na caixinha cujo vencimento é o de cada lote (ou que não vence). */
  readonly maturity_date?: string;
  readonly liquidity: 'daily' | 'at_maturity' | 'd_plus_n';
  readonly liquidity_days?: number;
  /** Presente só na caixinha: cada aporte é um lote e a regra diz qual sai primeiro. */
  readonly redemption_rule?: 'oldest_first' | 'newest_first';
  /** Caixinha cujos lotes vencem: meses entre o aporte e o vencimento do lote. */
  readonly lot_term_months?: number;
  readonly tax_regime: 'regressive' | 'exempt';
  readonly name?: string;
};

const assetParser: Parser<AssetResource> = {
  parse: (value) => {
    const asset =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)['asset']
        : undefined;
    if (typeof asset !== 'object' || asset === null) {
      throw new Error('A api respondeu o ativo fora do contrato');
    }
    return asset as AssetResource;
  },
};

export const createFixedIncomeAsset = (body: FixedIncomeBody): Promise<AssetResource> =>
  request('/api/assets', assetParser, { method: 'POST', body: JSON.stringify(body) });
