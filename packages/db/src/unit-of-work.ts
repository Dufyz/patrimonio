import type {
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
import { createCategoryRepository } from './repositories/category.repository.js';
import { createCorporateEventRepository } from './repositories/corporate_event.repository.js';
import { createInstitutionRepository } from './repositories/institution.repository.js';
import { createLedgerRepository } from './repositories/ledger.repository.js';
import { createOutboxRepository } from './repositories/outbox.repository.js';
import { createPayoutDismissalRepository } from './repositories/payout_dismissal.repository.js';
import { createPortfolioRepository } from './repositories/portfolio.repository.js';
import { createTransactionRepository } from './repositories/transaction.repository.js';

/**
 * Os repositórios criados sobre uma conexão — a global ou a da transação.
 *
 * O lado de `db` carrega também a própria conexão, que é o que o `apply` usa
 * para a trava e para o que não é consulta de repositório. `application` só
 * conhece `TransactionalRepositories`, sem o driver.
 */
export type DbRepositories = TransactionalRepositories & { readonly tx: Connection };

export const createRepositories = (sql: Connection): DbRepositories => ({
  tx: sql,
  outbox: createOutboxRepository(sql),
  businessDays: createBusinessDayRepository(sql),
  portfolios: createPortfolioRepository(sql),
  institutions: createInstitutionRepository(sql),
  categories: createCategoryRepository(sql),
  assets: createAssetRepository(sql),
  ledger: createLedgerRepository(sql),
  transactions: createTransactionRepository(sql),
  payoutDismissals: createPayoutDismissalRepository(sql),
  corporateEvents: createCorporateEventRepository(sql),
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

export const createUnitOfWork = (sql: Sql): UnitOfWork => ({
  run: async <F, S>(
    work: (repositories: TransactionalRepositories) => Promise<Either<F, S>>,
    options?: UnitOfWorkOptions,
  ): Promise<Either<F | ReturnType<typeof getRepositoryError>, S>> => {
    try {
      const value = await sql.begin(async (tx) => {
        if (options?.lock !== undefined) {
          await tx`select pg_advisory_xact_lock(hashtextextended(${options.lock}, 0))`;
        }

        const result = await work(createRepositories(tx));

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
