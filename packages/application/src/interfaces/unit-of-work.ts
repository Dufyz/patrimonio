import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';
import type { AlertRepository } from './alert.repository.js';
import type { BusinessDayRepository } from './business_day.repository.js';
import type { AssetRepository } from './asset.repository.js';
import type { AssetPageRepository } from './asset_page.repository.js';
import type { StatementRepository } from './statement.repository.js';
import type { CategoryRepository } from './category.repository.js';
import type { CorporateEventRepository } from './corporate_event.repository.js';
import type { InstitutionRepository } from './institution.repository.js';
import type { LedgerRepository } from './ledger.repository.js';
import type { ManualPriceRepository } from './manual_price.repository.js';
import type { MarketIngestionRepository } from './market_ingestion.repository.js';
import type { OutboxRepository } from './outbox.repository.js';
import type { OverviewRepository } from './overview.repository.js';
import type { PerformanceRepository } from './performance.repository.js';
import type { PayoutDismissalRepository } from './payout_dismissal.repository.js';
import type { PortfolioRepository } from './portfolio.repository.js';
import type { PositionViewRepository } from './position_view.repository.js';
import type { PriceRepository } from './price.repository.js';
import type { ProjectionRepository } from './projection.repository.js';
import type { TransactionRepository } from './transaction.repository.js';
import type { TransactionUndoRepository } from './transaction_undo.repository.js';

/**
 * Os repositórios criados sobre a transação. O container cria as instâncias
 * sobre a conexão global; o `apply` cria sobre o `tx`, e é por isso que cada
 * repositório é uma fábrica que aceita a conexão.
 *
 * Cresce a cada entidade: em E2 entram carteira, instituição, ativo e
 * lançamento; em E3 entram as tabelas de projeção, a leitura de preço e os
 * alertas; em E4 entra a escrita da ingestão de mercado; em E6 entram as
 * leituras que as telas pedem.
 */
export type TransactionalRepositories = {
  readonly outbox: OutboxRepository;
  readonly businessDays: BusinessDayRepository;
  readonly portfolios: PortfolioRepository;
  readonly institutions: InstitutionRepository;
  readonly categories: CategoryRepository;
  readonly assets: AssetRepository;
  readonly ledger: LedgerRepository;
  readonly manualPrices: ManualPriceRepository;
  readonly transactions: TransactionRepository;
  readonly payoutDismissals: PayoutDismissalRepository;
  readonly transactionUndos: TransactionUndoRepository;
  readonly corporateEvents: CorporateEventRepository;
  readonly projections: ProjectionRepository;
  /** Leitura: a tela de Posições, em duas consultas. */
  readonly positionViews: PositionViewRepository;
  /** Leitura: a página do ativo, também em duas. */
  readonly assetPages: AssetPageRepository;
  /** Leitura: o extrato do livro de lançamentos, em duas consultas. */
  readonly statements: StatementRepository;
  readonly prices: PriceRepository;
  readonly alerts: AlertRepository;
  /** Só leitura: o instantâneo da tela de abertura, numa consulta. */
  readonly overview: OverviewRepository;
  /** Só leitura: a tela de Desempenho, em duas consultas. */
  readonly performance: PerformanceRepository;
  readonly market: MarketIngestionRepository;
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
