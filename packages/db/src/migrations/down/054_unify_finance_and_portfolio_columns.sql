ALTER TABLE fin_recurring DROP CONSTRAINT IF EXISTS fin_recurring_aporte_coherent;
DELETE FROM fin_recurring WHERE kind = 'APORTE';
ALTER TABLE fin_recurring DROP CONSTRAINT fin_recurring_kind_valid;
ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_kind_valid CHECK (kind IN ('RECEITA', 'DESPESA'));
ALTER TABLE fin_recurring
  DROP COLUMN asset_id,
  DROP COLUMN portfolio_id,
  ALTER COLUMN category_id SET NOT NULL;

ALTER TABLE fin_account DROP COLUMN in_wealth;

ALTER TABLE fin_category
  DROP CONSTRAINT fin_category_nature_valid,
  DROP COLUMN nature;

DELETE FROM fin_movement WHERE kind IN ('APORTE', 'RESGATE', 'PROVENTO');
ALTER TABLE fin_movement DROP CONSTRAINT fin_movement_kind_valid;
ALTER TABLE fin_movement ADD CONSTRAINT fin_movement_kind_valid
  CHECK (kind IN ('TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA', 'AJUSTE'));
DROP INDEX IF EXISTS fin_movement_event_idx;
ALTER TABLE fin_movement DROP COLUMN event_id;

DROP INDEX IF EXISTS fin_entry_event_idx;
ALTER TABLE fin_entry DROP COLUMN event_id;

DROP INDEX IF EXISTS transaction_event_idx;
ALTER TABLE transaction
  DROP COLUMN account_id,
  DROP COLUMN event_id;

ALTER TABLE portfolio
  DROP CONSTRAINT portfolio_strategy_tolerance_range,
  DROP CONSTRAINT portfolio_expected_return_range,
  DROP COLUMN expected_return_pct,
  DROP COLUMN strategy_tolerance_pp;
