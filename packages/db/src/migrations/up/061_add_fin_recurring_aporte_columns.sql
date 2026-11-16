-- LIV-11 · recorrente de aporte: com carteira e ativo.
ALTER TABLE fin_recurring
  ADD COLUMN portfolio_id UUID REFERENCES portfolio (id) ON DELETE CASCADE,
  ADD COLUMN asset_id     UUID REFERENCES asset (id) ON DELETE SET NULL;
