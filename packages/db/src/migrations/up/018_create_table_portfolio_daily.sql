CREATE TABLE portfolio_daily (
  portfolio_id             UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
  position_date            DATE NOT NULL,
  total_value              NUMERIC(20,2) NOT NULL,
  net_flow                 NUMERIC(20,2) NOT NULL DEFAULT 0,
  income                   NUMERIC(20,2) NOT NULL DEFAULT 0,
  payouts                  NUMERIC(20,2) NOT NULL DEFAULT 0,
  quota_value              NUMERIC(20,12) NOT NULL,
  quota_count              NUMERIC(20,12) NOT NULL,
  cumulative_contributions NUMERIC(20,2) NOT NULL DEFAULT 0,
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portfolio_id, position_date),
  CONSTRAINT portfolio_daily_quota_positive CHECK (quota_value > 0 AND quota_count >= 0)
);

CREATE INDEX portfolio_daily_portfolio_date_idx
  ON portfolio_daily (portfolio_id, position_date);
