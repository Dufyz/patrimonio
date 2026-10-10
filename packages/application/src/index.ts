// ─── Erros ───────────────────────────────────────────────────────────────────
export {
  AppError,
  BadRequestError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  FormatChangedError,
  InvalidParameterError,
  MarketDataUnavailableError,
  MarketSourceRejectedError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  isAppError,
  isFormatChangedError,
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
  PortfolioDailyWrite,
  PositionDailyWrite,
  ProjectionRepository,
  RealizedResultWrite,
  TaxMonthWrite,
} from './interfaces/projection.repository.js';
export type {
  PositionView,
  PositionViewFacetRow,
  PositionViewFilter,
  PositionViewHeader,
  PositionViewRepository,
  PositionViewRow,
  PositionViewSummaryRow,
} from './interfaces/position_view.repository.js';
export type {
  SearchAssetRow,
  SearchFilter,
  SearchPageView,
  SearchRepository,
  SearchTransactionRow,
} from './interfaces/search.repository.js';
export type {
  StatementFilter,
  StatementGroupKey,
  StatementHistoryRow,
  StatementLedgerRow,
  StatementMonthRow,
  StatementPageView,
  StatementPair,
  StatementRepository,
  StatementSummaryRow,
} from './interfaces/statement.repository.js';
export { ASSET_PAGE_TRANSACTION_LIMIT } from './interfaces/asset_page.repository.js';
export type {
  AssetPageCorporateEventRow,
  AssetPageCustodianRow,
  AssetPageFacetRow,
  AssetPageFilter,
  AssetPageIdentityRow,
  AssetPageMarkRow,
  AssetPagePayoutMonthRow,
  AssetPagePeriod,
  AssetPagePointRow,
  AssetPagePortfolioRow,
  AssetPagePositionRow,
  AssetPagePriceRow,
  AssetPageRepository,
  AssetPageTransactionRow,
  AssetPageUpcomingPayoutRow,
  AssetPageView,
  AssetPageWindowRow,
} from './interfaces/asset_page.repository.js';
export type { PriceAt, PriceRepository } from './interfaces/price.repository.js';
export type {
  AnnouncedPayoutWrite,
  AssetPriceWrite,
  IndexQuoteWrite,
  MarketIngestionRepository,
  PendingAnnouncedPayout,
  SourceStatus,
} from './interfaces/market_ingestion.repository.js';
export type {
  AnnouncedPayoutSample,
  ClosingResult,
  CorporateActionProvider,
  CorporateEventSample,
  IndexProvider,
  IndexSample,
  PriceQuote,
  QuoteProvider,
  QuoteSource,
  SourcedClosing,
  TreasuryProvider,
  TreasuryQuote,
  TreasurySource,
} from './interfaces/market_data.js';
export type {
  AlertFinding,
  AlertRepository,
  AlertRule,
  AlertUpsertRow,
} from './interfaces/alert.repository.js';
export type {
  AllocationCategoryRow,
  AllocationPortfolioRow,
  AllocationQuery,
  AllocationRepository,
  AllocationSnapshot,
  AllocationTargetRow,
} from './interfaces/allocation.repository.js';
export type {
  GoalFlowRow,
  GoalInflationRow,
  GoalPortfolioRow,
  GoalRepository,
  GoalRow,
  GoalSnapshot,
  GoalSnapshotQuery,
} from './interfaces/goal.repository.js';
export type {
  OverviewAnchors,
  OverviewCategoryRow,
  OverviewDayRow,
  OverviewPortfolioRow,
  OverviewPositionRow,
  OverviewQuery,
  OverviewRepository,
  OverviewSnapshot,
  OverviewTargetRow,
} from './interfaces/overview.repository.js';
export type {
  PerformanceBenchmarkRow,
  PerformanceBreakdown,
  PerformanceBreakdownQuery,
  PerformanceCategoryRow,
  PerformanceClassFlow,
  PerformanceClassValue,
  PerformanceDayRow,
  PerformancePoint,
  PerformancePortfolioPoint,
  PerformanceSnapshotPortfolio,
  PerformanceRepository,
  PerformanceSnapshot,
  PerformanceSnapshotQuery,
} from './interfaces/performance.repository.js';
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
  ClassifiedLedgerRow,
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
export { interpretTransactionText } from './usecases/transaction/interpretText.js';
export type {
  TextChip,
  TextInterpretation,
} from './usecases/transaction/interpretText.js';
export { interpretTransaction } from './usecases/transaction/interpretTransaction.usecase.js';
export type {
  InterpretTransactionDeps,
  InterpretTransactionResult,
} from './usecases/transaction/interpretTransaction.usecase.js';
export { loadPlanContext } from './usecases/transaction/context.js';
export type { ContextAsset, ContextParams } from './usecases/transaction/context.js';
export {
  getTransaction,
  listTransactions,
} from './usecases/transaction/listTransactions.usecase.js';
export type { ListTransactionsDeps } from './usecases/transaction/listTransactions.usecase.js';
export { listPositions } from './usecases/position/listPositions.usecase.js';
export type {
  ListPositionsDeps,
  ListPositionsInput,
} from './usecases/position/listPositions.usecase.js';
export { searchGlobal } from './usecases/search/searchGlobal.usecase.js';
export type { SearchGlobalDeps } from './usecases/search/searchGlobal.usecase.js';
export { getStatement } from './usecases/statement/getStatement.usecase.js';
export type { GetStatementDeps } from './usecases/statement/getStatement.usecase.js';
export { statementEffect } from './usecases/statement/statementEffect.js';
export type { StatementEffectView } from './usecases/statement/statementEffect.js';
export { getAssetPage } from './usecases/asset/getAssetPage.usecase.js';
export type {
  GetAssetPageDeps,
  GetAssetPageInput,
} from './usecases/asset/getAssetPage.usecase.js';

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

// ─── Planos e casos de uso do pipeline (E3) ──────────────────────────────────
export { applyPlan } from './plans/apply.js';
export type {
  AlertWrite,
  ApplicablePlan,
  ApplyReport,
  ProjectionWrite,
  RealizedWrite,
} from './plans/apply.js';

export { coalesces, createDebouncePolicy } from './plans/debounce.js';
export type { DebounceConfig, DebouncePolicy } from './plans/debounce.js';

export { curveFor, planDailyClose, totalIsReliable } from './plans/daily_close.plan.js';
export type {
  CloseAsset,
  CloseEntry,
  CloseSeed,
  DailyCloseContext,
  DailyClosePlan,
  FixedIncomeTerms,
  PriceHealth,
  PriceOn,
} from './plans/daily_close.plan.js';

export { planRecalculation } from './plans/recalculation.plan.js';
export type {
  RecalculationContext,
  RecalculationPlan,
  RecalculationReport,
  TaxAnnotation,
} from './plans/recalculation.plan.js';

export { planTaxes } from './plans/taxes.plan.js';
export type { TaxSale, TaxesContext, TaxesPlan } from './plans/taxes.plan.js';

export {
  ALERT_GROUPS,
  isVisibleOn,
  reconcileAlerts as planAlertReconciliation,
} from './plans/alerts.plan.js';
export type {
  AlertGroup,
  AlertKey,
  AlertUpsert,
  AlertsContext,
  AlertsPlan,
} from './plans/alerts.plan.js';

export {
  closeAssetOf,
  loadRecalculationContext,
  loadTaxSales,
} from './usecases/pipeline/context.js';

export {
  portfolioLock as recalcPortfolioLock,
  recalculatePortfolio,
} from './usecases/pipeline/recalculatePortfolio.usecase.js';
export type {
  RecalculateInput,
  RecalculatePortfolioDeps,
  RecalculateResult,
} from './usecases/pipeline/recalculatePortfolio.usecase.js';

export { closeDay } from './usecases/pipeline/closeDay.usecase.js';
export type {
  CloseDayDeps,
  CloseDayInput,
  CloseDayResult,
  ClosedPortfolio,
} from './usecases/pipeline/closeDay.usecase.js';

export { reconcileAlerts } from './usecases/pipeline/reconcileAlerts.usecase.js';
export type {
  AlertRuleRunner,
  ReconcileAlertsDeps,
  ReconcileAlertsInput,
  ReconcileAlertsResult,
} from './usecases/pipeline/reconcileAlerts.usecase.js';

// ─── Dados de mercado ────────────────────────────────────────────────────────
export {
  CORPORATE_EVENT_RULE,
  PRICE_MISSING_RULE,
  PRICE_STALE_RULE,
  planBackfillWindow,
  planMarketIngestion,
} from './plans/market.plan.js';
export type {
  BackfillWindow,
  MarketIngestionContext,
  MarketIngestionPlan,
} from './plans/market.plan.js';
export {
  collectMarketData,
  recalcEventsFor,
} from './usecases/market/collectMarketData.usecase.js';
export type {
  CollectMarketDataDeps,
  CollectMarketDataInput,
  CollectMarketDataResult,
} from './usecases/market/collectMarketData.usecase.js';
export { backfillAsset } from './usecases/market/backfillAsset.usecase.js';
export type {
  BackfillAssetDeps,
  BackfillAssetInput,
  BackfillAssetResult,
} from './usecases/market/backfillAsset.usecase.js';
export { materializeAnnouncedPayouts } from './usecases/market/materializeAnnouncedPayouts.usecase.js';
export type {
  MaterializePayoutsDeps,
  MaterializePayoutsInput,
  MaterializePayoutsResult,
} from './usecases/market/materializeAnnouncedPayouts.usecase.js';
export { ingestCorporateActions } from './usecases/market/ingestCorporateActions.usecase.js';
export type {
  IngestCorporateActionsDeps,
  IngestCorporateActionsInput,
  IngestCorporateActionsResult,
} from './usecases/market/ingestCorporateActions.usecase.js';
export {
  corporateEventRunner,
  marketAlertRunners,
} from './usecases/market/marketAlertRunners.js';
export { getAssetPriceSeries } from './usecases/market/assetPriceSeries.usecase.js';
export type {
  AssetPriceSeriesDeps,
  AssetPriceSeriesInput,
  AssetPriceSeriesResult,
} from './usecases/market/assetPriceSeries.usecase.js';
export {
  getMarketHealth,
  refreshMarketData,
} from './usecases/market/marketHealth.usecase.js';
export type {
  MarketHealthDeps,
  MarketHealthInput,
  MarketHealthResult,
  MissingPrice,
  RefreshMarketInput,
  RefreshMarketResult,
  SourceBudget,
  SourceHealth,
} from './usecases/market/marketHealth.usecase.js';

// ─── Visão geral ─────────────────────────────────────────────────────────────
export { getOverview } from './usecases/overview/overview.usecase.js';

export { getPerformance } from './usecases/performance/performance.usecase.js';
export type {
  BreakdownKey,
  PerformanceBenchmark,
  PerformanceChart,
  PerformanceClassRow,
  PerformanceDecompositionRow,
  PerformanceDecompositionTotal,
  PerformanceDeps,
  PerformanceInput,
  PerformanceMethod,
  PerformancePortfolioRow,
  PerformanceResult,
  PerformanceScope,
  PerformanceWindowColumn,
  PerformanceWindowRow,
  PerformanceYear,
} from './usecases/performance/performance.usecase.js';
export type {
  ColoredComposition,
  ColoredNode,
  OverviewAttention,
  OverviewAttentionGroup,
  OverviewAttentionItem,
  OverviewChange,
  OverviewDeps,
  OverviewInput,
  OverviewPeriod,
  OverviewPortfolioShare,
  OverviewResult,
  OverviewScope,
  OverviewTopPosition,
  OverviewTotals,
} from './usecases/overview/overview.usecase.js';

export { getAllocation } from './usecases/allocation/getAllocation.usecase.js';
export type {
  AllocationComposition,
  AllocationContribution,
  AllocationNode,
  AllocationResult,
  AllocationRules,
  AllocationShare,
  GetAllocationDeps,
  GetAllocationInput,
} from './usecases/allocation/getAllocation.usecase.js';

export { getGoals } from './usecases/goal/getGoals.usecase.js';
export type {
  GetGoalsDeps,
  GetGoalsInput,
  GoalBlock,
  GoalChart,
  GoalContributionRow,
  GoalPace,
  GoalProjectionResult,
  GoalRate,
  GoalResult,
  GoalStatus,
  GoalsResult,
} from './usecases/goal/getGoals.usecase.js';
