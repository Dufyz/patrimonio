import { either } from '@patrimonio/shared';

import type {
  SearchAssetRow,
  SearchFilter,
  SearchRepository,
} from '../../interfaces/search.repository.js';

/**
 * T-09 · A busca global.
 *
 * O caso de uso faz o que o banco não faz: decide que busca em branco não vai
 * ao banco e monta a posição como um objeto só, ou como ausência. Achar e
 * ordenar é do repositório; o que significa cada resultado é da paleta.
 *
 * Texto vazio devolve a resposta vazia sem pagar consulta. A paleta sem texto
 * mostra recentes, telas e ações — nada disso mora aqui —, e o pedido só sai
 * quando há o que procurar.
 */
export type SearchGlobalDeps = { readonly search: SearchRepository };

const holdingOf = (row: SearchAssetRow) =>
  row.quantity === null || row.market_value === null
    ? null
    : {
        quantity: row.quantity,
        market_value: row.market_value,
        portfolio_names: [...row.portfolio_names],
      };

export const searchGlobal = (deps: SearchGlobalDeps) =>
  either(async function* (filter: SearchFilter) {
    const text = filter.text.trim();

    if (text === '') {
      return {
        query: '',
        assets: { total: 0, items: [] },
        transactions: { total: 0, items: [] },
      };
    }

    const view = yield* await deps.search.find({ ...filter, text });

    return {
      query: text,
      assets: {
        total: view.assets.total,
        items: view.assets.rows.map((row) => ({
          id: row.id,
          ticker: row.ticker,
          name: row.name,
          b3_type: row.b3_type,
          holding: holdingOf(row),
        })),
      },
      transactions: {
        total: view.transactions.total,
        items: view.transactions.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          payout_kind: row.payout_kind,
          trade_date: row.trade_date,
          portfolio_id: row.portfolio_id,
          portfolio_name: row.portfolio_name,
          asset_id: row.asset_id,
          ticker: row.ticker,
          asset_name: row.asset_name,
          b3_type: row.b3_type,
          quantity: row.quantity,
          net_amount: row.net_amount,
          pending: row.kind === 'payout' && row.confirmed_at === null,
        })),
      },
    };
  });
