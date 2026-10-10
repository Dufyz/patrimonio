// ─── Suporte ─────────────────────────────────────────────────────────────────
export {
  addDays,
  compareDateOnly,
  isDateOnly,
  minDateOnly,
  toDateOnly,
} from './support/date_only.js';
export type { DateOnly } from './support/date_only.js';
export {
  asBoolean,
  asDateOnly,
  asDateOnlyOrNull,
  asEnum,
  asEnumOrNull,
  asInteger,
  asIntegerOrNull,
  asIsoString,
  asIsoStringOrNull,
  asJsonOrNull,
  asNumeric,
  asNumericOrNull,
  asString,
  asStringOrNull,
} from './support/row.js';
export type { Row } from './support/row.js';

// ─── Pipeline ────────────────────────────────────────────────────────────────
export { RECALC_STATUSES, STAGES, isStage } from './pipeline/pipeline.entities.js';
export type {
  RecalcStatus,
  Stage,
  StageOutcome,
  StageResult,
  Transition,
} from './pipeline/pipeline.entities.js';
export { isPortfolioScoped, transition } from './pipeline/pipeline.transitions.js';

// ─── Outbox ──────────────────────────────────────────────────────────────────
export { dedupeKey } from './outbox/outbox.entities.js';
export type {
  OutboxEvent,
  OutboxEventDraft,
  OutboxPayload,
  OutboxPayloads,
} from './outbox/outbox.entities.js';
export { parseOutboxEventFromDB } from './outbox/outbox.parsers.js';

// ─── Dia útil ────────────────────────────────────────────────────────────────
export type { BusinessDay } from './business_day/business_day.entities.js';
export { parseBusinessDayFromDB } from './business_day/business_day.parsers.js';

// ─── Ativo ───────────────────────────────────────────────────────────────────
export {
  ASSET_ORIGINS,
  B3_TYPES,
  INDEXERS,
  LIQUIDITY_KINDS,
  PRICE_SOURCES,
  TAX_REGIMES,
  cashAssetName,
  cashAssetTicker,
  describeFixedIncome,
  fixedIncomeTicker,
  isB3Type,
  isIndexer,
} from './asset/asset.entities.js';
export type {
  Asset,
  AssetOrigin,
  B3Type,
  Indexer,
  LiquidityKind,
  PriceSource,
  TaxRegime,
} from './asset/asset.entities.js';
export { parseAssetFromDB } from './asset/asset.parsers.js';

// ─── Categoria ───────────────────────────────────────────────────────────────
export { classifyAsset, isColorToken, isRuleKey } from './category/category.entities.js';
export type { Category, ClassifiableAsset } from './category/category.entities.js';
export { parseCategoryFromDB } from './category/category.parsers.js';

// ─── Instituição ─────────────────────────────────────────────────────────────
export type { Institution } from './institution/institution.entities.js';
export { parseInstitutionFromDB } from './institution/institution.parsers.js';

// ─── Lançamento ──────────────────────────────────────────────────────────────
export {
  PAYOUT_KINDS,
  TRANSACTION_KINDS,
  isPayoutKind,
  isTransactionKind,
  settlementBusinessDays,
} from './transaction/transaction.entities.js';
export type {
  PayoutKind,
  Transaction,
  TransactionKind,
} from './transaction/transaction.entities.js';
export { parseTransactionFromDB } from './transaction/transaction.parsers.js';

// ─── Preço manual ────────────────────────────────────────────────────────────
export type { ManualPrice } from './manual_price/manual_price.entities.js';
export { parseManualPriceFromDB } from './manual_price/manual_price.parsers.js';

// ─── Evento corporativo ──────────────────────────────────────────────────────
export {
  CORPORATE_EVENT_KINDS,
  describeCorporateEvent,
  isCorporateEventKind,
} from './corporate_event/corporate_event.entities.js';
export type {
  CorporateEvent,
  CorporateEventKind,
} from './corporate_event/corporate_event.entities.js';
export { parseCorporateEventFromDB } from './corporate_event/corporate_event.parsers.js';

// ─── Provento não pago ───────────────────────────────────────────────────────
export type { PayoutDismissal } from './payout_dismissal/payout_dismissal.entities.js';
export { parsePayoutDismissalFromDB } from './payout_dismissal/payout_dismissal.parsers.js';

// ─── Projeção ────────────────────────────────────────────────────────────────
export {
  ALERT_GROUPS,
  ALERT_STATUSES,
  ASSET_CLASSES,
  COMPUTED_PRICE_KINDS,
  INDEX_CODES,
  POSITION_GROUP_BY,
  POSITION_UNITS,
  PRICE_SOURCE_KINDS,
  alertGroupFor,
  assetClassFor,
  indexForIndexer,
  isIndexCode,
} from './projection/projection.entities.js';
export type {
  AlertGroup,
  AlertInstance,
  AlertStatus,
  AssetClass,
  AssetPrice,
  ComputedPriceKind,
  IndexCode,
  IndexQuote,
  PortfolioDaily,
  PositionDaily,
  PositionGroupBy,
  PositionUnit,
  PriceSourceKind,
  RealizedResult,
  TaxMonth,
} from './projection/projection.entities.js';
export {
  parseAlertInstanceFromDB,
  parseAssetPriceFromDB,
  parseIndexQuoteFromDB,
  parsePortfolioDailyFromDB,
  parsePositionDailyFromDB,
  parseRealizedResultFromDB,
  parseTaxMonthFromDB,
} from './projection/projection.parsers.js';

// ─── Carteira ────────────────────────────────────────────────────────────────
export { TOLERANCE_PP } from './portfolio/portfolio.entities.js';
export {
  INDEX_LABELS,
  benchmarkLabel,
  describeBenchmark,
  formatBenchmark,
  normalizeBenchmark,
  parseBenchmark,
} from './portfolio/benchmark.js';
export type { BenchmarkValue } from './portfolio/benchmark.js';
export type { Portfolio, StrategyTarget } from './portfolio/portfolio.entities.js';
export {
  parsePortfolioFromDB,
  parseStrategyTargetFromDB,
} from './portfolio/portfolio.parsers.js';

// ─── Dados de mercado ────────────────────────────────────────────────────────
export { MARKET_RUN_KINDS, isMarketRunKind } from './market/market.entities.js';
export type {
  MarketRunKind,
  MarketSourceRun,
  MarketSourceRunDraft,
  PriceableAsset,
} from './market/market.entities.js';
export {
  parseMarketSourceRunFromDB,
  parsePriceableAssetFromDB,
} from './market/market.parsers.js';
