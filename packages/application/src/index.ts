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
  CorporateEventDraft,
  CorporateEventRepository,
} from './interfaces/corporate_event.repository.js';
export type {
  TransactionUndo,
  TransactionUndoDraft,
  TransactionUndoRepository,
} from './interfaces/transaction_undo.repository.js';
export type {
  PayoutDismissalDraft,
  PayoutDismissalRepository,
} from './interfaces/payout_dismissal.repository.js';
export type {
  TransactionFilter,
  TransactionPage,
  TransactionPatch,
  TransactionRepository,
  TransactionWrite,
} from './interfaces/transaction.repository.js';
export type {
  AssetDraft,
  AssetFilter,
  AssetRepository,
  AssetUsage,
  AssetWrite,
} from './interfaces/asset.repository.js';
export type {
  ManualPriceDraft,
  ManualPriceRepository,
} from './interfaces/manual_price.repository.js';
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
// ─── Planos ──────────────────────────────────────────────────────────────────
export { planTransfer } from './plans/transfer.plan.js';
export type {
  TransferContext,
  TransferLeg,
  TransferPlan,
  TransferPreview,
} from './plans/transfer.plan.js';
export { planDeletion, planEvents, planTransaction } from './plans/transaction.plan.js';
export type {
  DeletionPreview,
  AllocationPreview,
  BeforeAfter,
  PlanAsset,
  PlanContext,
  TransactionDraft,
  TransactionPlan,
  TransactionPreview,
} from './plans/transaction.plan.js';

export {
  createTransaction,
  portfolioLock,
  prepareTransaction,
  previewTransaction,
  resolveAsset,
  resolveFees,
  resolveSettlement,
} from './usecases/transaction/createTransaction.usecase.js';
export type {
  CreateTransactionDeps,
  CreateTransactionInput,
  NewAssetInput,
  TransactionResult,
} from './usecases/transaction/createTransaction.usecase.js';
export {
  createCashMovement,
  ensureCashAsset,
} from './usecases/transaction/cashMovement.usecase.js';
export type {
  CashMovementDeps,
  CashMovementInput,
  CashMovementResult,
} from './usecases/transaction/cashMovement.usecase.js';
export { createPayout } from './usecases/transaction/createPayout.usecase.js';
export type {
  CreatePayoutDeps,
  CreatePayoutInput,
  PayoutResult,
} from './usecases/transaction/createPayout.usecase.js';
export {
  confirmCorporateEvent,
  listCorporateEvents,
  registerCorporateEvent,
} from './usecases/corporate_event/corporateEvent.usecases.js';
export type {
  ConfirmCorporateEventResult,
  CorporateEventDeps,
  CorporateEventWriteDeps,
} from './usecases/corporate_event/corporateEvent.usecases.js';
export { confirmPayout } from './usecases/transaction/confirmPayout.usecase.js';
export type {
  ConfirmPayoutDeps,
  ConfirmPayoutInput,
  ConfirmPayoutResult,
} from './usecases/transaction/confirmPayout.usecase.js';
export { dismissPayout } from './usecases/transaction/dismissPayout.usecase.js';
export type {
  DismissPayoutDeps,
  DismissPayoutInput,
  DismissPayoutResult,
} from './usecases/transaction/dismissPayout.usecase.js';
export {
  previewTransfer,
  transferPosition,
} from './usecases/transaction/transferPosition.usecase.js';
export type {
  TransferDeps,
  TransferInput,
  TransferResult,
} from './usecases/transaction/transferPosition.usecase.js';
export {
  previewUpdate,
  updateTransaction,
} from './usecases/transaction/updateTransaction.usecase.js';
export type {
  UpdateTransactionDeps,
  UpdateTransactionInput,
  UpdateTransactionResult,
} from './usecases/transaction/updateTransaction.usecase.js';
export {
  deleteTransaction,
  undoDeletion,
} from './usecases/transaction/deleteTransaction.usecase.js';
export type {
  DeleteTransactionDeps,
  DeleteTransactionResult,
  UndoResult,
} from './usecases/transaction/deleteTransaction.usecase.js';
export {
  IDEMPOTENCY_TTL_HOURS,
  findReplay,
  replayGroup,
} from './usecases/transaction/idempotency.js';
export { loadPlanContext } from './usecases/transaction/context.js';
export type { ContextAsset, ContextParams } from './usecases/transaction/context.js';
export {
  getTransaction,
  listTransactions,
} from './usecases/transaction/listTransactions.usecase.js';
export type { ListTransactionsDeps } from './usecases/transaction/listTransactions.usecase.js';

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
export {
  deleteManualPrice,
  listManualPrices,
  setManualPrice,
} from './usecases/asset/manualPrice.usecase.js';
export type {
  ManualPriceDeps,
  ManualPricePreview,
  ManualPriceReadDeps,
  SetManualPriceInput,
  SetManualPriceResult,
} from './usecases/asset/manualPrice.usecase.js';
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
