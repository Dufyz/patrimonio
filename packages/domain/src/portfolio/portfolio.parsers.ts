import { RECALC_STATUSES } from '../pipeline/pipeline.entities.js';
import {
  asDateOnlyOrNull,
  asEnum,
  asInteger,
  asIntegerOrNull,
  asIsoString,
  asIsoStringOrNull,
  asNumeric,
  asNumericOrNull,
  asString,
  asStringOrNull,
} from '../support/row.js';
import type { Row } from '../support/row.js';
import { REBALANCE_MODES } from './portfolio.entities.js';
import type { Portfolio, StrategyTarget } from './portfolio.entities.js';

export const parsePortfolioFromDB = (row: Row): Portfolio => ({
  id: asString(row, 'id'),
  name: asString(row, 'name'),
  purpose: asStringOrNull(row, 'purpose'),
  benchmark_id: asStringOrNull(row, 'benchmark_id'),
  tolerance_pp: asNumeric(row, 'tolerance_pp'),
  max_asset_weight_pct: asNumericOrNull(row, 'max_asset_weight_pct'),
  rebalance_mode: asEnum(row, 'rebalance_mode', REBALANCE_MODES),
  review_every_months: asIntegerOrNull(row, 'review_every_months'),
  sort_order: asInteger(row, 'sort_order'),
  recalc_status: asEnum(row, 'recalc_status', RECALC_STATUSES),
  recalc_from_date: asDateOnlyOrNull(row, 'recalc_from_date'),
  recalc_error: asStringOrNull(row, 'recalc_error'),
  recalc_updated_at: asIsoStringOrNull(row, 'recalc_updated_at'),
  archived_at: asIsoStringOrNull(row, 'archived_at'),
  created_at: asIsoString(row, 'created_at'),
  updated_at: asIsoString(row, 'updated_at'),
});

export const parseStrategyTargetFromDB = (row: Row): StrategyTarget => ({
  portfolio_id: asString(row, 'portfolio_id'),
  category_id: asString(row, 'category_id'),
  target_pct: asNumeric(row, 'target_pct'),
  created_at: asIsoString(row, 'created_at'),
  updated_at: asIsoString(row, 'updated_at'),
});
