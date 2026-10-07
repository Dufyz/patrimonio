// ─── Erros ───────────────────────────────────────────────────────────────────
export {
  AppError,
  BadRequestError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  InvalidParameterError,
  MarketDataUnavailableError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  isAppError,
} from './errors/app-error.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────
export type { Clock } from './interfaces/clock.js';
export type { BusinessDayRepository } from './interfaces/business_day.repository.js';
export type {
  EnqueuedEvent,
  OutboxRepository,
  StageExecution,
} from './interfaces/outbox.repository.js';
export type {
  TransactionalRepositories,
  UnitOfWork,
  UnitOfWorkOptions,
} from './interfaces/unit-of-work.js';
export type {
  MovedContent,
  PortfolioContent,
  PortfolioDraft,
  PortfolioRepository,
  PortfolioWrite,
  StrategyTargetWrite,
} from './interfaces/portfolio.repository.js';

// ─── Casos de uso ────────────────────────────────────────────────────────────
export {
  createPortfolio,
  validateTargets,
} from './usecases/portfolio/createPortfolio.usecase.js';
export type {
  CreatePortfolioDeps,
  CreatePortfolioInput,
} from './usecases/portfolio/createPortfolio.usecase.js';
export { updatePortfolio } from './usecases/portfolio/updatePortfolio.usecase.js';
export type {
  UpdatePortfolioDeps,
  UpdatePortfolioInput,
} from './usecases/portfolio/updatePortfolio.usecase.js';
export { setPortfolioArchived } from './usecases/portfolio/archivePortfolio.usecase.js';
export type { ArchivePortfolioDeps } from './usecases/portfolio/archivePortfolio.usecase.js';
export { deletePortfolio } from './usecases/portfolio/deletePortfolio.usecase.js';
export type {
  DeletePortfolioDeps,
  DeletePortfolioInput,
  DeletePortfolioResult,
} from './usecases/portfolio/deletePortfolio.usecase.js';
export {
  getPortfolio,
  listPortfolios,
} from './usecases/portfolio/listPortfolios.usecase.js';
export type { ListPortfoliosDeps } from './usecases/portfolio/listPortfolios.usecase.js';
export { putStrategy } from './usecases/portfolio/putStrategy.usecase.js';
export type { PutStrategyDeps } from './usecases/portfolio/putStrategy.usecase.js';
