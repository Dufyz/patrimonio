import {
  asBoolean,
  asDateOnly,
  asDateOnlyOrNull,
  asEnum,
  asInteger,
  asIsoString,
  asJsonOrNull,
  asNumeric,
  asNumericOrNull,
  asString,
  asStringOrNull,
} from '../support/row.js';
import type { Row } from '../support/row.js';
import {
  ALERT_STATUSES,
  ASSET_CLASSES,
  COMPUTED_PRICE_KINDS,
  PRICE_SOURCE_KINDS,
} from './projection.entities.js';
import type {
  AlertInstance,
  AssetPrice,
  IndexQuote,
  PortfolioDaily,
  PositionDaily,
  RealizedResult,
  TaxMonth,
} from './projection.entities.js';

/**
 * A cópia é campo a campo de propósito: coluna nova no `SELECT *` sem linha aqui
 * não aparece na saída, e é o que impede uma coluna interna de vazar para a API
 * sem alguém decidir isso.
 */
export const parsePositionDailyFromDB = (row: Row): PositionDaily => ({
  portfolio_id: asString(row, 'portfolio_id'),
  asset_id: asString(row, 'asset_id'),
  position_date: asDateOnly(row, 'position_date'),
  quantity: asNumeric(row, 'quantity'),
  avg_price: asNumeric(row, 'avg_price'),
  cost_basis: asNumeric(row, 'cost_basis'),
  market_value: asNumeric(row, 'market_value'),
  price_source_kind: asEnum(row, 'price_source_kind', COMPUTED_PRICE_KINDS),
  accrued_interest: asNumeric(row, 'accrued_interest'),
  computed_at: asIsoString(row, 'computed_at'),
});

export const parsePortfolioDailyFromDB = (row: Row): PortfolioDaily => ({
  portfolio_id: asString(row, 'portfolio_id'),
  position_date: asDateOnly(row, 'position_date'),
  total_value: asNumeric(row, 'total_value'),
  net_flow: asNumeric(row, 'net_flow'),
  income: asNumeric(row, 'income'),
  payouts: asNumeric(row, 'payouts'),
  quota_value: asNumeric(row, 'quota_value'),
  quota_count: asNumeric(row, 'quota_count'),
  cumulative_contributions: asNumeric(row, 'cumulative_contributions'),
  computed_at: asIsoString(row, 'computed_at'),
});

export const parseRealizedResultFromDB = (row: Row): RealizedResult => ({
  transaction_id: asString(row, 'transaction_id'),
  portfolio_id: asString(row, 'portfolio_id'),
  asset_id: asString(row, 'asset_id'),
  trade_date: asDateOnly(row, 'trade_date'),
  proceeds: asNumeric(row, 'proceeds'),
  cost_consumed: asNumeric(row, 'cost_consumed'),
  result: asNumeric(row, 'result'),
  exempt: asBoolean(row, 'exempt'),
  loss_offset: asNumeric(row, 'loss_offset'),
  computed_at: asIsoString(row, 'computed_at'),
});

export const parseTaxMonthFromDB = (row: Row): TaxMonth => ({
  year: asInteger(row, 'year'),
  month: asInteger(row, 'month'),
  asset_class: asEnum(row, 'asset_class', ASSET_CLASSES),
  sales_total: asNumeric(row, 'sales_total'),
  gross_result: asNumeric(row, 'gross_result'),
  exempt: asBoolean(row, 'exempt'),
  loss_carried_forward: asNumeric(row, 'loss_carried_forward'),
  computed_at: asIsoString(row, 'computed_at'),
});

export const parseAlertInstanceFromDB = (row: Row): AlertInstance => ({
  rule_kind: asString(row, 'rule_kind'),
  subject_id: asString(row, 'subject_id'),
  portfolio_id: asStringOrNull(row, 'portfolio_id'),
  status: asEnum(row, 'status', ALERT_STATUSES),
  snooze_until: asDateOnlyOrNull(row, 'snooze_until'),
  payload: asJsonOrNull(row, 'payload') ?? {},
  first_seen_at: asIsoString(row, 'first_seen_at'),
  updated_at: asIsoString(row, 'updated_at'),
});

export const parseAssetPriceFromDB = (row: Row): AssetPrice => ({
  asset_id: asString(row, 'asset_id'),
  price_date: asDateOnly(row, 'price_date'),
  close: asNumeric(row, 'close'),
  source: asString(row, 'source'),
  source_kind: asEnum(row, 'source_kind', PRICE_SOURCE_KINDS),
  fetched_at: asIsoString(row, 'fetched_at'),
});

export const parseIndexQuoteFromDB = (row: Row): IndexQuote => ({
  index_code: asString(row, 'index_code'),
  quote_date: asDateOnly(row, 'quote_date'),
  daily_factor: asNumeric(row, 'daily_factor'),
  raw_value: asNumericOrNull(row, 'raw_value'),
  source: asString(row, 'source'),
  fetched_at: asIsoString(row, 'fetched_at'),
});
