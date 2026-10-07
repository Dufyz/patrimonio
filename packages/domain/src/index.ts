// ─── Suporte ─────────────────────────────────────────────────────────────────
export {
  addDays,
  compareDateOnly,
  isDateOnly,
  minDateOnly,
  toDateOnly,
} from './support/date_only.js';
export type { DateOnly } from './support/date_only.js';

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
