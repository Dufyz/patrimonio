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
  AssetDraft,
  AssetFilter,
  AssetRepository,
  AssetUsage,
  AssetWrite,
} from './interfaces/asset.repository.js';
export type {
  LedgerRepository,
  LedgerRow,
  PortfolioHolding,
} from './interfaces/ledger.repository.js';
export type {
  CategoryDraft,
  CategoryRepository,
  CategoryUsage,
  CategoryWrite,
} from './interfaces/category.repository.js';
export type {
  InstitutionDraft,
  InstitutionRepository,
  InstitutionUsage,
  InstitutionWrite,
  IssuerExposure,
} from './interfaces/institution.repository.js';
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
export {
  archiveAsset,
  classifyWithRules,
  createAsset,
  createAssetIn,
  deleteAsset,
  getAsset,
  listAssets,
  updateAsset,
} from './usecases/asset/asset.usecases.js';
export type { AssetDeps, AssetWriteDeps } from './usecases/asset/asset.usecases.js';
export { createFixedIncomeAsset } from './usecases/asset/createFixedIncomeAsset.usecase.js';
export type {
  CreateFixedIncomeDeps,
  CreateFixedIncomeInput,
  FixedIncomeKind,
} from './usecases/asset/createFixedIncomeAsset.usecase.js';
export {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from './usecases/category/category.usecases.js';
export type {
  CategoryDeps,
  CategoryWriteDeps,
} from './usecases/category/category.usecases.js';
export {
  createInstitution,
  deleteInstitution,
  getFgcExposure,
  listInstitutions,
  updateInstitution,
} from './usecases/institution/institution.usecases.js';
export type {
  FgcExposure,
  InstitutionDeps,
  InstitutionWriteDeps,
} from './usecases/institution/institution.usecases.js';
