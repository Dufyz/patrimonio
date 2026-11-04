import type { Sql } from '../postgresql.js';

export type RemovedDemo = {
  readonly portfolios: number;
  readonly transactions: number;
  readonly assets: number;
  readonly institutions: number;
  readonly kept_assets: number;
  readonly kept_institutions: number;
};

/**
 * Remove o que o `dev_seed.sql` marcou como demonstração: as carteiras e os
 * lançamentos delas, os ativos e as instituições, as cotações de índice e o
 * histórico de coleta de mentira.
 *
 * Lançamento real não é tocado. Ativo ou instituição de demonstração que uma
 * carteira real já usa deixa de ser demonstração em vez de ser apagado, porque
 * apagá-lo levaria o lançamento junto ou a remoção falharia no meio.
 */
export const removeDemoData = async (sql: Sql): Promise<RemovedDemo> =>
  sql.begin(async (tx) => {
    const keptAssets = await tx<{ id: string }[]>`
      UPDATE asset
         SET is_demo = FALSE
       WHERE is_demo
         AND id IN (
           SELECT transaction.asset_id
             FROM transaction
             JOIN portfolio ON portfolio.id = transaction.portfolio_id
            WHERE NOT portfolio.is_demo AND transaction.asset_id IS NOT NULL
         )
      RETURNING id
    `;

    const keptInstitutions = await tx<{ id: string }[]>`
      UPDATE institution
         SET is_demo = FALSE
       WHERE is_demo
         AND (
           id IN (
             SELECT transaction.institution_id
               FROM transaction
               JOIN portfolio ON portfolio.id = transaction.portfolio_id
              WHERE NOT portfolio.is_demo
           )
           OR id IN (SELECT issuer_id FROM asset WHERE NOT is_demo AND issuer_id IS NOT NULL)
         )
      RETURNING id
    `;

    await tx`
      DELETE FROM pipeline_outbox
       WHERE origin_request_id = 'dev-seed'
          OR (stage = 'recalc'
              AND payload ->> 'portfolio_id' IN (
                SELECT id::TEXT FROM portfolio WHERE is_demo
              ))
    `;

    const transactions = await tx<{ id: string }[]>`
      DELETE FROM transaction
       WHERE portfolio_id IN (SELECT id FROM portfolio WHERE is_demo)
      RETURNING id
    `;

    const portfolios = await tx<{ id: string }[]>`
      DELETE FROM portfolio WHERE is_demo RETURNING id
    `;

    const assets = await tx<{ id: string }[]>`
      DELETE FROM asset WHERE is_demo RETURNING id
    `;

    const institutions = await tx<{ id: string }[]>`
      DELETE FROM institution WHERE is_demo RETURNING id
    `;

    await tx`DELETE FROM index_quote WHERE source = 'dev-seed'`;
    await tx`DELETE FROM market_source_run WHERE source = 'dev-seed'`;

    return {
      portfolios: portfolios.length,
      transactions: transactions.length,
      assets: assets.length,
      institutions: institutions.length,
      kept_assets: keptAssets.length,
      kept_institutions: keptInstitutions.length,
    };
  });
