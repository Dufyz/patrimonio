import { toDateOnly } from '../support/date_only.js';
import type { BusinessDay } from './business_day.entities.js';

export const parseBusinessDayFromDB = (row: Record<string, unknown>): BusinessDay => ({
  calendar_date: toDateOnly(row['calendar_date'] as Date | string),
  is_business_day: row['is_business_day'] === true,
  is_bank_holiday: row['is_bank_holiday'] === true,
  is_trading_holiday: row['is_trading_holiday'] === true,
  holiday_name:
    row['holiday_name'] === null || row['holiday_name'] === undefined
      ? null
      : String(row['holiday_name']),
});
