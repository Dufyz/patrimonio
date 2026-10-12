ALTER TABLE transaction DROP CONSTRAINT IF EXISTS transaction_expected_only_on_payout;
ALTER TABLE transaction DROP COLUMN IF EXISTS expected_net_amount;
