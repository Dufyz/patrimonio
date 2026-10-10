CREATE TYPE recalc_status AS ENUM ('idle', 'queued', 'running', 'failed');

CREATE TABLE portfolio (
  id                   UUID PRIMARY KEY,
  name                 TEXT NOT NULL,
  benchmark            TEXT,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  recalc_status        recalc_status NOT NULL DEFAULT 'idle',
  recalc_from_date     DATE,
  recalc_error         TEXT,
  recalc_updated_at    TIMESTAMP WITH TIME ZONE,
  archived_at          TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX portfolio_name_active_idx
  ON portfolio (LOWER(name)) WHERE archived_at IS NULL;

CREATE TRIGGER portfolio_set_updated_at
  BEFORE UPDATE ON portfolio
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
