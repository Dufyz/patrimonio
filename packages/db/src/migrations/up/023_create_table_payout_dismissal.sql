CREATE TABLE payout_dismissal (
  id                  UUID PRIMARY KEY,
  portfolio_id        UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
  asset_id            UUID REFERENCES asset (id) ON DELETE SET NULL,
  payout_kind         payout_kind NOT NULL,
  record_date         DATE NOT NULL,
  payment_date        DATE NOT NULL,
  expected_net_amount NUMERIC(20,2) NOT NULL,
  reason              TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX payout_dismissal_asset_record_idx
  ON payout_dismissal (asset_id, record_date);
CREATE INDEX payout_dismissal_portfolio_idx ON payout_dismissal (portfolio_id);
