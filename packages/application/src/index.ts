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
