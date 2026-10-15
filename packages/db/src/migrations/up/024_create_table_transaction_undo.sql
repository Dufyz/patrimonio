CREATE TABLE transaction_undo (
  id             UUID PRIMARY KEY,
  transaction_id UUID NOT NULL,
  portfolio_id   UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
  payload        JSONB NOT NULL,
  from_date      DATE NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX transaction_undo_transaction_idx ON transaction_undo (transaction_id);
CREATE INDEX transaction_undo_expires_idx ON transaction_undo (expires_at);
