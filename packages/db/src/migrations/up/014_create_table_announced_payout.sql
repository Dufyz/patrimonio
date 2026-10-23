CREATE TABLE announced_payout (
  id                          UUID PRIMARY KEY,
  asset_id                    UUID NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
  payout_kind                 payout_kind NOT NULL,
  record_date                 DATE NOT NULL,
  payment_date                DATE,
  amount_per_share            NUMERIC(20,8) NOT NULL,
  source                      TEXT NOT NULL,
  materialized_transaction_id UUID REFERENCES transaction (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT announced_payout_unique UNIQUE (asset_id, payout_kind, record_date),
  CONSTRAINT announced_payout_amount_positive CHECK (amount_per_share > 0)
);

CREATE INDEX announced_payout_payment_idx ON announced_payout (payment_date);

CREATE TRIGGER announced_payout_set_updated_at
  BEFORE UPDATE ON announced_payout
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
