import {
  asBoolean,
  asDateOnly,
  asDateOnlyOrNull,
  asEnum,
  asEnumOrNull,
  asInteger,
  asIsoString,
  asJsonOrNull,
  asString,
  asStringOrNull,
} from '../support/row.js';
import type { Row } from '../support/row.js';
import { PRICE_SOURCE_KINDS } from '../projection/projection.entities.js';
import { MARKET_RUN_KINDS } from './market.entities.js';
import type { MarketSourceRun, PriceableAsset } from './market.entities.js';

/** Cópia campo a campo: coluna nova no `SELECT *` não vaza para a API. */
export const parseMarketSourceRunFromDB = (row: Row): MarketSourceRun => ({
  id: asString(row, 'id'),
  source: asString(row, 'source'),
  kind: asEnum(row, 'kind', MARKET_RUN_KINDS),
  reference_date: asDateOnlyOrNull(row, 'reference_date'),
  started_at: asIsoString(row, 'started_at'),
  finished_at: asIsoString(row, 'finished_at'),
  ok: asBoolean(row, 'ok'),
  source_kind: asEnumOrNull(row, 'source_kind', PRICE_SOURCE_KINDS),
  requests: asInteger(row, 'requests'),
  items: asInteger(row, 'items'),
  missing: asInteger(row, 'missing'),
  error: asStringOrNull(row, 'error'),
  detail: asJsonOrNull(row, 'detail'),
  created_at: asIsoString(row, 'created_at'),
});

export const parsePriceableAssetFromDB = (row: Row): PriceableAsset => ({
  asset_id: asString(row, 'asset_id'),
  ticker: asString(row, 'ticker'),
  b3_type: asStringOrNull(row, 'b3_type'),
  first_trade_date: asDateOnly(row, 'first_trade_date'),
  indexer: asStringOrNull(row, 'indexer'),
  maturity_date: asDateOnlyOrNull(row, 'maturity_date'),
});
