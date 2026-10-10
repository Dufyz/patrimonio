CREATE TYPE pipeline_stage AS ENUM (
  'recalc', 'market', 'close', 'alerts', 'import', 'backup'
);

CREATE TABLE pipeline_outbox (
  id             UUID PRIMARY KEY,
  stage          pipeline_stage NOT NULL,
  dedupe_key     TEXT NOT NULL,
  payload        JSONB NOT NULL,
  available_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  debounce_until TIMESTAMPTZ,
  dispatched_at  TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  failed_at      TIMESTAMPTZ,
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  origin_request_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX pipeline_outbox_pending_key_idx
  ON pipeline_outbox (dedupe_key)
  WHERE dispatched_at IS NULL AND failed_at IS NULL;

CREATE INDEX pipeline_outbox_pending_idx
  ON pipeline_outbox (available_at, created_at)
  WHERE dispatched_at IS NULL AND failed_at IS NULL;

CREATE INDEX pipeline_outbox_stage_completed_idx
  ON pipeline_outbox (stage, completed_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE INDEX pipeline_outbox_failed_idx
  ON pipeline_outbox (failed_at DESC) WHERE failed_at IS NOT NULL;
