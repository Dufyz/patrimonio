import type { DateOnly, IndexQuote } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * A leitura de preço e de índice no formato que o fechamento consome. A escrita
 * destas tabelas é de E4: aqui só se lê, e o que se lê carrega de quando é — é
 * isso que permite ao motor dizer `stale` em vez de mostrar um número velho com
 * a confiança de um número novo.
 */
export type PriceAt = {
  readonly asset_id: string;
  /** A data do preço encontrado, que pode ser anterior à data pedida. */
  readonly price_date: DateOnly;
  readonly close: string;
  /** Preço digitado à mão vence a fonte automática enquanto vale. */
  readonly manual: boolean;
};

export type PriceRepository = {
  /**
   * O preço mais recente de cada ativo em ou antes de uma data, numa consulta
   * só. Uma consulta por ativo seria N+1 vezes trezentos, todos os dias de dez
   * anos de reconstrução.
   */
  readonly latestPricesOn: (
    assetIds: readonly string[],
    date: DateOnly,
  ) => Promise<Either<AppError, PriceAt[]>>;

  /**
   * Toda a série de preço de um conjunto de ativos num intervalo, para o
   * recálculo não voltar ao banco um dia por vez.
   */
  readonly pricesBetween: (
    assetIds: readonly string[],
    from: DateOnly,
    to: DateOnly,
  ) => Promise<Either<AppError, PriceAt[]>>;

  /** Os fatores diários de um índice num intervalo. */
  readonly indexFactors: (
    indexCodes: readonly string[],
    from: DateOnly,
    to: DateOnly,
  ) => Promise<Either<AppError, IndexQuote[]>>;

  /** Ativos com posição aberta e sem preço do dia: o que a tela de dados lista. */
  readonly assetsWithoutPriceOn: (
    date: DateOnly,
  ) => Promise<Either<AppError, string[]>>;
};
