ALTER TABLE transaction
  DROP CONSTRAINT IF EXISTS transaction_maturity_not_before_trade,
  DROP COLUMN IF EXISTS maturity_date;

ALTER TABLE asset
  DROP CONSTRAINT IF EXISTS asset_lot_term_needs_lots,
  DROP CONSTRAINT IF EXISTS asset_lot_term_positive,
  DROP COLUMN IF EXISTS lot_term_months;
