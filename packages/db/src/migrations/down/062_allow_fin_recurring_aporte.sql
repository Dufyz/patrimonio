ALTER TABLE fin_recurring DROP CONSTRAINT IF EXISTS fin_recurring_aporte_coherent;
DELETE FROM fin_recurring WHERE kind = 'APORTE';
ALTER TABLE fin_recurring DROP CONSTRAINT fin_recurring_kind_valid;
ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_kind_valid CHECK (kind IN ('RECEITA', 'DESPESA'));
ALTER TABLE fin_recurring ALTER COLUMN category_id SET NOT NULL;
