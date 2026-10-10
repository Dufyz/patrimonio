CREATE TABLE business_day (
  calendar_date      DATE    PRIMARY KEY,
  is_business_day    BOOLEAN NOT NULL,
  is_bank_holiday    BOOLEAN NOT NULL DEFAULT FALSE,
  is_trading_holiday BOOLEAN NOT NULL DEFAULT FALSE,
  holiday_name       TEXT,
  CONSTRAINT business_day_holiday_has_name
    CHECK ((is_bank_holiday OR is_trading_holiday) = (holiday_name IS NOT NULL))
);

CREATE INDEX business_day_trading_idx
  ON business_day (calendar_date) WHERE is_business_day;
