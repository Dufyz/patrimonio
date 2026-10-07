import type {
  DateOnly,
  Portfolio,
  RebalanceMode,
  RecalcStatus,
  StrategyTarget,
} from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * O que a escrita aceita. As quatro colunas de recálculo não estão aqui de
 * propósito: só a máquina de estados do pipeline as escreve.
 */
export type PortfolioWrite = {
  readonly name?: string | undefined;
  readonly purpose?: string | null | undefined;
  readonly benchmark_id?: string | null | undefined;
  readonly tolerance_pp?: string | undefined;
  readonly max_asset_weight_pct?: string | null | undefined;
  readonly rebalance_mode?: RebalanceMode | undefined;
  readonly review_every_months?: number | null | undefined;
  readonly sort_order?: number | undefined;
};

export type PortfolioDraft = PortfolioWrite & { readonly name: string };

export type StrategyTargetWrite = {
  readonly category_id: string;
  readonly target_pct: string;
};

export type PortfolioContent = {
  /** Quantos lançamentos impedem a exclusão, e de quantos ativos distintos. */
  readonly transactions: number;
  readonly assets: number;
};

export type MovedContent = {
  readonly moved: number;
  /** A data mais antiga movida: o recálculo do destino recomeça dela. */
  readonly from_date: DateOnly | null;
};

/**
 * O que a máquina de estados do pipeline escreve. É o único caminho até as quatro
 * colunas de recálculo, e quem chama é o `apply` — nenhum caso de uso as toca.
 */
export type RecalcTransitionWrite = {
  readonly recalc_status: RecalcStatus;
  readonly from_date: DateOnly | null;
  readonly error: string | null;
};

export type PortfolioRepository = {
  readonly findById: (id: string) => Promise<Either<AppError, Portfolio | null>>;

  readonly findByName: (name: string) => Promise<Either<AppError, Portfolio | null>>;

  readonly list: (options: {
    readonly includeArchived: boolean;
  }) => Promise<Either<AppError, Portfolio[]>>;

  readonly create: (draft: PortfolioDraft) => Promise<Either<AppError, Portfolio>>;

  readonly update: (
    id: string,
    patch: PortfolioWrite,
  ) => Promise<Either<AppError, Portfolio | null>>;

  /** Arquivar e desarquivar são a mesma operação, com o carimbo invertido. */
  readonly setArchived: (
    id: string,
    archived: boolean,
  ) => Promise<Either<AppError, Portfolio | null>>;

  readonly remove: (id: string) => Promise<Either<AppError, boolean>>;

  readonly contentSummary: (id: string) => Promise<Either<AppError, PortfolioContent>>;

  /**
   * Leva lançamentos de uma carteira para outra, numa consulta só. Devolve a
   * data mais antiga movida, que é de onde o recálculo do destino precisa
   * recomeçar.
   */
  readonly moveContent: (
    from: string,
    to: string,
  ) => Promise<Either<AppError, MovedContent>>;

  /** Apaga os lançamentos da carteira. Muda o patrimônio histórico. */
  readonly deleteTransactions: (id: string) => Promise<Either<AppError, number>>;

  /**
   * Aplica a transição de `recalc_status`. Separado de `update` de propósito: as
   * quatro colunas de recálculo não estão em `PortfolioWrite`, e é assim que
   * nenhuma rota consegue escrevê-las nem por acidente.
   */
  readonly applyRecalcTransition: (
    id: string,
    write: RecalcTransitionWrite,
  ) => Promise<Either<AppError, void>>;

  /** As carteiras ativas, para o fechamento diário percorrer todas. */
  readonly listActiveIds: () => Promise<Either<AppError, string[]>>;

  readonly listTargets: (
    portfolioId: string,
  ) => Promise<Either<AppError, StrategyTarget[]>>;

  /**
   * Substitui o alvo inteiro. A soma precisa fechar 100 ou zero, e quem recusa
   * é o trigger diferido do banco — por isso apagar e regravar na mesma
   * transação é seguro.
   */
  readonly replaceTargets: (
    portfolioId: string,
    targets: readonly StrategyTargetWrite[],
  ) => Promise<Either<AppError, StrategyTarget[]>>;
};
