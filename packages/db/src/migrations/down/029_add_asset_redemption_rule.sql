ALTER TABLE asset
  DROP CONSTRAINT IF EXISTS asset_lots_are_manual_fixed_income,
  DROP COLUMN IF EXISTS redemption_rule;

DROP TYPE IF EXISTS redemption_rule;
