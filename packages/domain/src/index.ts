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

// ─── Instituição ─────────────────────────────────────────────────────────────
export {
  FGC_LIMIT_BRL,
  INSTITUTION_ROLES,
  isInstitutionRole,
} from './institution/institution.entities.js';
export type { Institution, InstitutionRole } from './institution/institution.entities.js';
export { parseInstitutionFromDB } from './institution/institution.parsers.js';

// ─── Carteira ────────────────────────────────────────────────────────────────
export { REBALANCE_MODES, isRebalanceMode } from './portfolio/portfolio.entities.js';
export type {
  Portfolio,
  RebalanceMode,
  StrategyTarget,
} from './portfolio/portfolio.entities.js';
export {
  parsePortfolioFromDB,
  parseStrategyTargetFromDB,
} from './portfolio/portfolio.parsers.js';
