-- Não há volta para os dados: contas de benefício viraram corrente e os
-- créditos viraram ajustes. Aqui só a estrutura é recriada.
ALTER TABLE fin_account DROP CONSTRAINT fin_account_type_valid;
ALTER TABLE fin_account
  ADD COLUMN credit_amount NUMERIC(18,2),
  ADD COLUMN credit_day INTEGER,
  ADD COLUMN credits_from DATE;
ALTER TABLE fin_account ADD CONSTRAINT fin_account_type_valid
  CHECK (type IN ('CORRENTE', 'POUPANCA', 'CARTEIRA', 'BENEFICIO'));
ALTER TABLE fin_account ADD CONSTRAINT fin_account_credit_day_valid
  CHECK (credit_day IS NULL OR credit_day BETWEEN 1 AND 31);
ALTER TABLE fin_account ADD CONSTRAINT fin_account_credit_amount_positive
  CHECK (credit_amount IS NULL OR credit_amount > 0);
ALTER TABLE fin_account ADD CONSTRAINT fin_account_credit_together CHECK (
  (credit_amount IS NULL AND credit_day IS NULL AND credits_from IS NULL)
  OR (credit_amount IS NOT NULL AND credit_day IS NOT NULL AND credits_from IS NOT NULL AND type = 'BENEFICIO')
);
ALTER TABLE fin_movement DROP CONSTRAINT fin_movement_kind_valid;
ALTER TABLE fin_movement ADD CONSTRAINT fin_movement_kind_valid
  CHECK (kind IN ('CREDITO', 'TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA', 'AJUSTE'));
