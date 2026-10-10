CREATE TYPE market_run_kind AS ENUM (
  'quotes', 'indices', 'treasury', 'backfill', 'cotahist', 'contract_check'
);

CREATE TABLE market_source_run (
  id             UUID PRIMARY KEY,
  source         TEXT NOT NULL,
  kind           market_run_kind NOT NULL,
  reference_date DATE,
  started_at     TIMESTAMPTZ NOT NULL,
  finished_at    TIMESTAMPTZ NOT NULL,
  ok             BOOLEAN NOT NULL,
  source_kind    price_source_kind,
  requests       INTEGER NOT NULL DEFAULT 0,
  items          INTEGER NOT NULL DEFAULT 0,
  missing        INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  detail         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_source_run_finished_after_started
    CHECK (finished_at >= started_at),
  CONSTRAINT market_source_run_counts_non_negative
    CHECK (requests >= 0 AND items >= 0 AND missing >= 0),
  CONSTRAINT market_source_run_failure_explains
    CHECK (ok OR error IS NOT NULL)
);

CREATE INDEX market_source_run_source_idx
  ON market_source_run (source, finished_at DESC);

CREATE INDEX market_source_run_kind_idx
  ON market_source_run (kind, finished_at DESC);

CREATE INDEX market_source_run_requests_idx
  ON market_source_run (source, started_at) WHERE requests > 0;
