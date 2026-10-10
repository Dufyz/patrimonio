import type {
  DebouncePolicy,
  TransactionalRepositories,
  UnitOfWork,
  UnitOfWorkOptions,
} from '@patrimonio/application';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { getRepositoryError } from './errors/repository-error.js';
import type { Connection, Sql } from './postgresql.js';
import { createBusinessDayRepository } from './repositories/business_day.repository.js';
import { createAssetRepository } from './repositories/asset.repository.js';
import { createAssetPageRepository } from './repositories/asset_page.repository.js';
import { createStatementRepository } from './repositories/statement.repository.js';
import { createCategoryRepository } from './repositories/category.repository.js';
import { createCorporateEventRepository } from './repositories/corporate_event.repository.js';
import { createInstitutionRepository } from './repositories/institution.repository.js';
import { createLedgerRepository } from './repositories/ledger.repository.js';
import { createManualPriceRepository } from './repositories/manual_price.repository.js';
import { createMarketIngestionRepository } from './repositories/market_ingestion.repository.js';
import { createAlertRepository } from './repositories/alert.repository.js';
import { createOverviewRepository } from './repositories/overview.repository.js';
import { createAllocationRepository } from './repositories/allocation.repository.js';
import { createGoalRepository } from './repositories/goal.repository.js';
import { createPerformanceRepository } from './repositories/performance.repository.js';
import { createOutboxRepository } from './repositories/outbox.repository.js';
import { createPriceRepository } from './repositories/price.repository.js';
import { createProjectionRepository } from './repositories/projection.repository.js';
import { createPayoutDismissalRepository } from './repositories/payout_dismissal.repository.js';
import { createPortfolioRepository } from './repositories/portfolio.repository.js';
import { createPositionViewRepository } from './repositories/position_view.repository.js';
import { createTransactionRepository } from './repositories/transaction.repository.js';
import { createTransactionUndoRepository } from './repositories/transaction_undo.repository.js';

/**
 * Os repositórios criados sobre uma conexão — a global ou a da transação.
 *
 * O lado de `db` carrega também a própria conexão, que é o que o `apply` usa
 * para a trava e para o que não é consulta de repositório. `application` só
 * conhece `TransactionalRepositories`, sem o driver.
 */
export type DbRepositories = TransactionalRepositories & { readonly tx: Connection };

/**
 * A política de coalescência entra por aqui, não é decidida em `db`: a espera e o
 * teto são regra de pipeline, e regra mora em `application`. O que `db` faz é
 * aplicá-la antes de gravar o evento.
 */
export type RepositoryOptions = { readonly debounce?: DebouncePolicy | undefined };

export const createRepositories = (
  sql: Connection,
  options: RepositoryOptions = {},
): DbRepositories => ({
  tx: sql,
  outbox: createOutboxRepository(sql, options.debounce),
  businessDays: createBusinessDayRepository(sql),
  portfolios: createPortfolioRepository(sql),
  institutions: createInstitutionRepository(sql),
  categories: createCategoryRepository(sql),
  assets: createAssetRepository(sql),
  ledger: createLedgerRepository(sql),
  manualPrices: createManualPriceRepository(sql),
  transactions: createTransactionRepository(sql),
  payoutDismissals: createPayoutDismissalRepository(sql),
  transactionUndos: createTransactionUndoRepository(sql),
  corporateEvents: createCorporateEventRepository(sql),
  projections: createProjectionRepository(sql),
  positionViews: createPositionViewRepository(sql),
  assetPages: createAssetPageRepository(sql),
  statements: createStatementRepository(sql),
  prices: createPriceRepository(sql),
  alerts: createAlertRepository(sql),
  overview: createOverviewRepository(sql),
  performance: createPerformanceRepository(sql),
  allocation: createAllocationRepository(sql),
  goals: createGoalRepository(sql),
  market: createMarketIngestionRepository(sql),
});

/**
 * `throw` de um marcador é a única forma de pedir ROLLBACK ao driver. A falha
 * original viaja dentro dele e volta intacta do outro lado — quem chamou o
 * caso de uso recebe o mesmo `failure` que o trabalho produziu, não um erro de
 * banco.
 */
const ABORT = Symbol('unit-of-work/abort');

type Abort<F> = { readonly [ABORT]: true; readonly failure: F };

const isAbort = <F>(value: unknown): value is Abort<F> =>
  typeof value === 'object' && value !== null && ABORT in value;

export const createUnitOfWork = (
  sql: Sql,
  /**
   * Nomeado, e não `options`: o `run` tem um `options` próprio — a trava — e o
   * nome repetido sombreava este, de forma que a política de coalescência nunca
   * chegava aos repositórios da transação. O compilador pegou; o teste não teria.
   */
  repositoryOptions: RepositoryOptions = {},
): UnitOfWork => ({
  run: async <F, S>(
    work: (repositories: TransactionalRepositories) => Promise<Either<F, S>>,
    options?: UnitOfWorkOptions,
  ): Promise<Either<F | ReturnType<typeof getRepositoryError>, S>> => {
    try {
      const value = await sql.begin(async (tx) => {
        if (options?.lock !== undefined) {
          await tx`select pg_advisory_xact_lock(hashtextextended(${options.lock}, 0))`;
        }

        const result = await work(createRepositories(tx, repositoryOptions));

        if (result.isFailure()) {
          const abort: Abort<F> = { [ABORT]: true, failure: result.value };
          throw abort;
        }

        return result.value;
      });

      return success(value as S);
    } catch (error) {
      if (isAbort<F>(error)) return failure(error.failure);

      return failure(getRepositoryError(error));
    }
  },
});
