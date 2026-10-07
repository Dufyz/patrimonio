import {
  asDateOnlyOrNull,
  asEnum,
  asEnumOrNull,
  asIntegerOrNull,
  asIsoString,
  asIsoStringOrNull,
  asNumericOrNull,
  asString,
  asStringOrNull,
} from '../support/row.js';
import type { Row } from '../support/row.js';
import {
  ASSET_ORIGINS,
  B3_TYPES,
  INDEXERS,
  LIQUIDITY_KINDS,
  PRICE_SOURCES,
  TAX_REGIMES,
} from './asset.entities.js';
import type { Asset } from './asset.entities.js';

export const parseAssetFromDB = (row: Row): Asset => ({
  id: asString(row, 'id'),
  ticker: asString(row, 'ticker'),
  name: asString(row, 'name'),
  origin: asEnum(row, 'origin', ASSET_ORIGINS),
  b3_type: asEnumOrNull(row, 'b3_type', B3_TYPES),
  category_id: asStringOrNull(row, 'category_id'),
  sector: asStringOrNull(row, 'sector'),
  price_source: asEnum(row, 'price_source', PRICE_SOURCES),
  issuer_id: asStringOrNull(row, 'issuer_id'),
  indexer: asEnumOrNull(row, 'indexer', INDEXERS),
  rate: asNumericOrNull(row, 'rate'),
  issued_at: asDateOnlyOrNull(row, 'issued_at'),
  maturity_date: asDateOnlyOrNull(row, 'maturity_date'),
  liquidity: asEnumOrNull(row, 'liquidity', LIQUIDITY_KINDS),
  liquidity_days: asIntegerOrNull(row, 'liquidity_days'),
  tax_regime: asEnumOrNull(row, 'tax_regime', TAX_REGIMES),
  archived_at: asIsoStringOrNull(row, 'archived_at'),
  created_at: asIsoString(row, 'created_at'),
  updated_at: asIsoString(row, 'updated_at'),
});
