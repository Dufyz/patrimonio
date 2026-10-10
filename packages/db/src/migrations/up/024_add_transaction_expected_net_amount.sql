ALTER TABLE transaction ADD COLUMN expected_net_amount NUMERIC(20,2);

ALTER TABLE transaction ADD CONSTRAINT transaction_expected_only_on_payout
  CHECK (expected_net_amount IS NULL OR kind = 'payout');
