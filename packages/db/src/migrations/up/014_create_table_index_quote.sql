CREATE TABLE index_quote (
  index_code   TEXT NOT NULL,
  quote_date   DATE NOT NULL REFERENCES business_day (calendar_date),
  daily_factor NUMERIC(20,12) NOT NULL,
  raw_value    NUMERIC(20,8),
  source       TEXT NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (index_code, quote_date),
  CONSTRAINT index_quote_factor_positive CHECK (daily_factor > 0)
);

CREATE INDEX index_quote_code_date_idx ON index_quote (index_code, quote_date);
