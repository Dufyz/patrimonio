import {
  asDateOnly,
  asEnum,
  asIsoString,
  asIsoStringOrNull,
  asNumeric,
  asString,
} from '../support/row.js';
import type { Row } from '../support/row.js';
import { CORPORATE_EVENT_KINDS } from './corporate_event.entities.js';
import type { CorporateEvent } from './corporate_event.entities.js';

export const parseCorporateEventFromDB = (row: Row): CorporateEvent => ({
  id: asString(row, 'id'),
  asset_id: asString(row, 'asset_id'),
  kind: asEnum(row, 'kind', CORPORATE_EVENT_KINDS),
  record_date: asDateOnly(row, 'record_date'),
  ratio_from: asNumeric(row, 'ratio_from'),
  ratio_to: asNumeric(row, 'ratio_to'),
  confirmed_at: asIsoStringOrNull(row, 'confirmed_at'),
  created_at: asIsoString(row, 'created_at'),
  updated_at: asIsoString(row, 'updated_at'),
});
