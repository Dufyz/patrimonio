-- LIV-11 · o aporte recorrente não tem categoria e tem regras próprias.
ALTER TABLE fin_recurring ALTER COLUMN category_id DROP NOT NULL;
ALTER TABLE fin_recurring DROP CONSTRAINT fin_recurring_kind_valid;
ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_kind_valid
  CHECK (kind IN ('RECEITA', 'DESPESA', 'APORTE'));
ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_aporte_coherent CHECK (
  (kind = 'APORTE' AND category_id IS NULL AND portfolio_id IS NOT NULL
    AND source_type = 'CONTA' AND mode = 'MANUAL' AND NOT split)
  OR (kind <> 'APORTE' AND category_id IS NOT NULL AND portfolio_id IS NULL AND asset_id IS NULL)
);
