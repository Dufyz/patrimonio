CREATE TYPE recalc_status AS ENUM ('idle', 'queued', 'running', 'failed');

CREATE TABLE portfolio (
  id                   UUID PRIMARY KEY,
  name                 TEXT NOT NULL,
  benchmark            TEXT,
  strategy_tolerance_pp NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
  -- PRJ-06 · rentabilidade anual esperada, em %, usada só pela projeção.
  expected_return_pct  NUMERIC(5, 2),
  sort_order           INTEGER NOT NULL DEFAULT 0,
  recalc_status        recalc_status NOT NULL DEFAULT 'idle',
  recalc_from_date     DATE,
  recalc_error         TEXT,
  recalc_updated_at    TIMESTAMP WITH TIME ZONE,
  archived_at          TIMESTAMP WITH TIME ZONE,
  is_demo              BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT portfolio_expected_return_range CHECK (expected_return_pct IS NULL OR (expected_return_pct >= 0 AND expected_return_pct <= 100)),
  CONSTRAINT portfolio_strategy_tolerance_range CHECK (strategy_tolerance_pp > 0 AND strategy_tolerance_pp <= 100),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX portfolio_name_active_idx
  ON portfolio (LOWER(name)) WHERE archived_at IS NULL;

CREATE TRIGGER portfolio_set_updated_at
  BEFORE UPDATE ON portfolio
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
