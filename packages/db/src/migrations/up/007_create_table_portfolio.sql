CREATE TYPE rebalance_mode AS ENUM ('contributions_only', 'buy_and_sell');
CREATE TYPE recalc_status AS ENUM ('idle', 'queued', 'running', 'failed');

CREATE TABLE portfolio (
  id                   UUID PRIMARY KEY,
  name                 TEXT NOT NULL,
  purpose              TEXT,
  benchmark_id         UUID REFERENCES benchmark (id) ON DELETE SET NULL,
  tolerance_pp         NUMERIC(6,2) NOT NULL DEFAULT 5,
  max_asset_weight_pct NUMERIC(6,2),
  rebalance_mode       rebalance_mode NOT NULL DEFAULT 'contributions_only',
  review_every_months  SMALLINT,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  recalc_status        recalc_status NOT NULL DEFAULT 'idle',
  recalc_from_date     DATE,
  recalc_error         TEXT,
  recalc_updated_at    TIMESTAMP WITH TIME ZONE,
  archived_at          TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT portfolio_tolerance_range CHECK (tolerance_pp >= 0 AND tolerance_pp <= 100),
  CONSTRAINT portfolio_max_weight_range
    CHECK (max_asset_weight_pct IS NULL OR (max_asset_weight_pct > 0 AND max_asset_weight_pct <= 100)),
  CONSTRAINT portfolio_review_months_positive
    CHECK (review_every_months IS NULL OR review_every_months > 0)
);

CREATE UNIQUE INDEX portfolio_name_active_idx
  ON portfolio (LOWER(name)) WHERE archived_at IS NULL;

CREATE TRIGGER portfolio_set_updated_at
  BEFORE UPDATE ON portfolio
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
