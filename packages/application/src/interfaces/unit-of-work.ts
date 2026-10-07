import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';
import type { BusinessDayRepository } from './business_day.repository.js';
import type { CategoryRepository } from './category.repository.js';
import type { InstitutionRepository } from './institution.repository.js';
import type { OutboxRepository } from './outbox.repository.js';
import type { PortfolioRepository } from './portfolio.repository.js';

/**
 * Os repositórios criados sobre a transação. O container cria as instâncias
 * sobre a conexão global; o `apply` cria sobre o `tx`, e é por isso que cada
 * repositório é uma fábrica que aceita a conexão.
 *
 * Cresce a cada entidade: em E2 entram carteira, instituição, ativo e
 * lançamento.
 */
export type TransactionalRepositories = {
  readonly outbox: OutboxRepository;
  readonly businessDays: BusinessDayRepository;
  readonly portfolios: PortfolioRepository;
  readonly institutions: InstitutionRepository;
  readonly categories: CategoryRepository;
};

export type UnitOfWorkOptions = {
  /**
   * Trava de escopo tomada dentro da transação, antes do trabalho: dois
   * recálculos da mesma carteira serializam em vez de se sobreporem.
   * `pg_advisory_xact_lock` — o pooler da Supabase roda em modo transação, e
   * trava de sessão não sobreviveria a ele.
   */
  readonly lock?: string;
};

/**
 * Um `failure` devolvido dentro do trabalho aborta a transação e volta como o
 * mesmo `failure`. É o que garante que abortar não deixe evento órfão na
 * outbox: o evento e o estado que o origina vivem ou morrem juntos.
 */
export type UnitOfWork = {
  readonly run: <F, S>(
    work: (repositories: TransactionalRepositories) => Promise<Either<F, S>>,
    options?: UnitOfWorkOptions,
  ) => Promise<Either<F | AppError, S>>;
};
