import { asBoolean, asEnum, asIsoString, asNumeric, asString } from '../support/row.js';
import type { Row } from '../support/row.js';
import { INSTITUTION_ROLES } from './institution.entities.js';
import type { Institution } from './institution.entities.js';

export const parseInstitutionFromDB = (row: Row): Institution => ({
  id: asString(row, 'id'),
  name: asString(row, 'name'),
  role: asEnum(row, 'role', INSTITUTION_ROLES),
  fgc_covered: asBoolean(row, 'fgc_covered'),
  brokerage_per_order: asNumeric(row, 'brokerage_per_order'),
  custody_monthly_fee: asNumeric(row, 'custody_monthly_fee'),
  created_at: asIsoString(row, 'created_at'),
  updated_at: asIsoString(row, 'updated_at'),
});
