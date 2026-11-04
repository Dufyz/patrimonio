import {
  asBoolean,
  asDateOnlyOrNull,
  asEnum,
  asIsoString,
  asString,
} from '../support/row.js';
import type { Row } from '../support/row.js';
import { INSTRUMENT_TYPES } from './instrument.entities.js';
import type { ListedInstrument } from './instrument.entities.js';

export const parseListedInstrumentFromDB = (row: Row): ListedInstrument => ({
  id: asString(row, 'id'),
  ticker: asString(row, 'ticker'),
  name: asString(row, 'name'),
  b3_type: asEnum(row, 'b3_type', INSTRUMENT_TYPES),
  maturity_date: asDateOnlyOrNull(row, 'maturity_date'),
  source: asString(row, 'source'),
  active: asBoolean(row, 'active'),
  last_trade_date: asDateOnlyOrNull(row, 'last_trade_date'),
  created_at: asIsoString(row, 'created_at'),
  updated_at: asIsoString(row, 'updated_at'),
});
