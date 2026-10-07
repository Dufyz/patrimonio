import type { LedgerEntry } from '@patrimonio/calc';
import type { DateOnly } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * A leitura do livro no formato que o motor de cálculo consome. É o "carregar"
 * da tríade carregar, planejar, aplicar: uma consulta traz tudo o que o plano
 * precisa, e o plano não faz I/O nenhum.
 */
export type LedgerRow = LedgerEntry & {
  readonly portfolio_id: string;
  readonly asset_id: string | null;
  readonly institution_id: string;
};

export type PortfolioHolding = {
  readonly portfolio_id: string;
  /** O lançamento mais antigo daquela carteira para o ativo. */
  readonly from_date: DateOnly;
};

export type LedgerRepository = {
  /** Os lançamentos de um ativo numa carteira: a sequência do preço médio. */
  readonly entriesForPortfolioAsset: (
    portfolioId: string,
    assetId: string,
  ) => Promise<Either<AppError, LedgerRow[]>>;

  /** Os lançamentos de um ativo em todas as carteiras, para arquivar e excluir. */
  readonly entriesForAsset: (assetId: string) => Promise<Either<AppError, LedgerRow[]>>;

  /**
   * O caixa de uma carteira numa instituição é a soma do que entrou e saiu ali:
   * não existe coluna de saldo, e por isso a leitura é do livro.
   */
  readonly entriesForPortfolioInstitution: (
    portfolioId: string,
    institutionId: string,
  ) => Promise<Either<AppError, LedgerRow[]>>;

  /** As carteiras que têm lançamento do ativo, com a data mais antiga de cada. */
  readonly portfoliosHoldingAsset: (
    assetId: string,
  ) => Promise<Either<AppError, PortfolioHolding[]>>;

  /**
   * O livro inteiro da carteira até uma data. O peso de cada posição sai daqui,
   * aplicado pelo motor — e não de uma soma em SQL, que erraria todo
   * desdobramento: evento corporativo muda quantidade por razão, não por soma.
   *
   * Em E3 esta leitura passa a ter `position_daily` como atalho; até lá o livro
   * é a única verdade, e lê-lo inteiro é o que mantém o número certo.
   */
  readonly entriesForPortfolio: (
    portfolioId: string,
    untilDate: DateOnly,
  ) => Promise<Either<AppError, LedgerRow[]>>;
};
