import type { PriceRepository } from '@patrimonio/application';
import { parseIndexQuoteFromDB } from '@patrimonio/domain';
import type { DateOnly, Row } from '@patrimonio/domain';
import { asDateOnly, asNumeric, asString } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * A leitura de preço do fechamento. O preço manual vence a fonte automática
 * enquanto vale — é o que L-14 promete — e a consulta resolve isso com um `union`
 * e um `distinct on`, em vez de o motor decidir depois com duas listas na mão.
 *
 * `asset_price` e `manual_price` são lidas juntas de propósito: o fechamento
 * precisa de um preço por ativo, não de duas respostas para escolher.
 */
const parsePriceAt = (
  row: Row,
): {
  readonly asset_id: string;
  readonly price_date: DateOnly;
  readonly close: string;
  readonly manual: boolean;
} => ({
  asset_id: asString(row, 'asset_id'),
  price_date: asDateOnly(row, 'price_date'),
  close: asNumeric(row, 'close'),
  manual: row['manual'] === true,
});

export const createPriceRepository = (sql: Connection): PriceRepository => ({
  /**
   * O preço vigente de cada ativo numa data, numa consulta. Uma consulta por ativo
   * seria N+1 vezes trezentos — e o fechamento roda todos os dias.
   */
  latestPricesOn: async (assetIds: readonly string[], date: DateOnly) => {
    if (assetIds.length === 0) return success([]);

    try {
      const rows = await sql<Row[]>`
        select distinct on (asset_id) asset_id, price_date, close, manual
          from (
            select asset_id, price_date, close, false as manual
              from asset_price
             where asset_id = any(${sql.array([...assetIds])}::uuid[])
               and price_date <= ${date}
            union all
            select asset_id, price_date, price as close, true as manual
              from manual_price
             where asset_id = any(${sql.array([...assetIds])}::uuid[])
               and price_date <= ${date}
          ) as prices
         -- Mesma data: o manual vence, porque foi uma decisão do usuário.
         order by asset_id, price_date desc, manual desc
      `;

      return success(rows.map((row) => parsePriceAt(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * A série inteira de um intervalo, para o recálculo não voltar ao banco um dia
   * por vez. A mesma regra de precedência: numa data com os dois, o manual fica.
   */
  pricesBetween: async (assetIds: readonly string[], from: DateOnly, to: DateOnly) => {
    if (assetIds.length === 0) return success([]);

    try {
      const rows = await sql<Row[]>`
        select distinct on (asset_id, price_date) asset_id, price_date, close, manual
          from (
            select asset_id, price_date, close, false as manual
              from asset_price
             where asset_id = any(${sql.array([...assetIds])}::uuid[])
               and price_date between ${from} and ${to}
            union all
            select asset_id, price_date, price as close, true as manual
              from manual_price
             where asset_id = any(${sql.array([...assetIds])}::uuid[])
               and price_date between ${from} and ${to}
          ) as prices
         order by asset_id, price_date, manual desc
      `;

      return success(rows.map((row) => parsePriceAt(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  indexFactors: async (indexCodes: readonly string[], from: DateOnly, to: DateOnly) => {
    if (indexCodes.length === 0) return success([]);

    try {
      const rows = await sql<Row[]>`
        select *
          from index_quote
         where index_code = any(${sql.array([...indexCodes])}::text[])
           and quote_date between ${from} and ${to}
         order by index_code, quote_date
      `;

      return success(rows.map((row) => parseIndexQuoteFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * Ativos com posição aberta e sem preço do dia. É o que a tela de dados de
   * mercado lista, pronto para preço manual — e a lista sai de `position_daily`,
   * não do cadastro: ativo arquivado sem posição não é problema de ninguém.
   */
  assetsWithoutPriceOn: async (date: DateOnly) => {
    try {
      const rows = await sql<{ asset_id: string }[]>`
        select distinct position.asset_id
          from position_daily as position
          join asset on asset.id = position.asset_id
         where position.position_date = (
                 select max(position_date) from position_daily
                  where position_date <= ${date}
               )
           and position.quantity <> 0
           and asset.price_source = 'auto'
           and not exists (
                 select 1 from asset_price
                  where asset_price.asset_id = position.asset_id
                    and asset_price.price_date = ${date}
               )
      `;

      return success(rows.map((row) => row.asset_id));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
