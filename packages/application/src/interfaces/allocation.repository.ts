import type { DateOnly, RecalcStatus } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * A leitura da tela de Estratégia, em **uma** consulta.
 *
 * A tela precisa de quatro coisas — a carteira com as regras dela, o cadastro de
 * categorias, o valor de cada categoria no último fechamento e o alvo declarado —
 * e todas dependem da mesma data de referência. Uma consulta com CTEs devolve as
 * quatro sobre o mesmo fechamento; quatro consultas deixariam cada uma escolher o
 * seu "hoje", e o banco fica em outra rede.
 *
 * O cadastro vem inteiro, com ou sem posição: é o que permite declarar alvo para
 * uma categoria que ainda está vazia. Sem ele, a primeira estratégia só poderia
 * usar o que já está em carteira.
 */

export type AllocationPortfolioRow = {
  readonly portfolio_id: string;
  readonly name: string;
  readonly recalc_status: RecalcStatus;
  readonly benchmark_id: string | null;
  readonly benchmark_name: string | null;
  /** O dia em que o alvo foi salvo pela última vez. Nulo sem alvo. */
  readonly reviewed_on: DateOnly | null;
  /** O valor total da carteira no fechamento. Nulo quando nunca fechou. */
  readonly total_value: string | null;
};

/**
 * Uma categoria do cadastro e o que a carteira tem nela. `group_id` é nulo para
 * o que está na raiz — um grupo sem filhos, como Caixa, é uma categoria que se
 * comporta como grupo de uma linha só.
 */
export type AllocationCategoryRow = {
  readonly category_id: string;
  readonly category_name: string;
  readonly group_id: string | null;
  readonly group_name: string | null;
  /** A ordem do grupo no cadastro. Nulo para o que está na raiz. */
  readonly group_sort_order: number | null;
  readonly color_token: string;
  readonly sort_order: number;
  readonly value: string;
};

export type AllocationTargetRow = {
  readonly category_id: string;
  readonly target_pct: string;
};

export type AllocationSnapshot = {
  /** O último fechamento da carteira em ou antes da data pedida. */
  readonly reference_date: DateOnly | null;
  /** Nulo quando a carteira não existe ou está arquivada. */
  readonly portfolio: AllocationPortfolioRow | null;
  readonly categories: readonly AllocationCategoryRow[];
  readonly targets: readonly AllocationTargetRow[];
};

export type AllocationQuery = {
  readonly portfolio_id: string;
  readonly on_date: DateOnly;
};

export type AllocationRepository = {
  readonly snapshot: (
    query: AllocationQuery,
  ) => Promise<Either<AppError, AllocationSnapshot>>;
};
