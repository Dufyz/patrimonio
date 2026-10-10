CREATE TABLE realized_result (
  transaction_id UUID PRIMARY KEY REFERENCES transaction (id) ON DELETE CASCADE,
  portfolio_id   UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
  asset_id       UUID NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
  trade_date     DATE NOT NULL,
  proceeds       NUMERIC(20,2) NOT NULL,
  cost_consumed  NUMERIC(20,2) NOT NULL,
  result         NUMERIC(20,2) NOT NULL,
  exempt         BOOLEAN NOT NULL DEFAULT FALSE,
  loss_offset    NUMERIC(20,2) NOT NULL DEFAULT 0,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX realized_result_portfolio_date_idx
  ON realized_result (portfolio_id, trade_date);
CREATE INDEX realized_result_asset_idx ON realized_result (asset_id, trade_date);
