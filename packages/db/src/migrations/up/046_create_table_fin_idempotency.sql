CREATE TABLE fin_idempotency (
  key        TEXT PRIMARY KEY,
  operation  TEXT NOT NULL,
  response   JSONB NOT NULL,
  status     INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX fin_idempotency_created_idx ON fin_idempotency (created_at);
