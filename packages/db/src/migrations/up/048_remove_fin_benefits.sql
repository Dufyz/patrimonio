-- Benefício deixa de existir como tipo de conta: vira conta corrente, e o
-- crédito mensal automático sai. Os créditos já gerados viram ajustes, para o
-- saldo continuar o mesmo.
UPDATE fin_movement SET kind = 'AJUSTE' WHERE kind = 'CREDITO';
DROP INDEX IF EXISTS fin_movement_credit_month_idx;
ALTER TABLE fin_movement DROP CONSTRAINT fin_movement_kind_valid;
ALTER TABLE fin_movement ADD CONSTRAINT fin_movement_kind_valid
  CHECK (kind IN ('TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA', 'AJUSTE', 'APORTE', 'RESGATE', 'PROVENTO'));

ALTER TABLE fin_account DROP CONSTRAINT fin_account_credit_together;
ALTER TABLE fin_account DROP CONSTRAINT fin_account_credit_day_valid;
ALTER TABLE fin_account DROP CONSTRAINT fin_account_credit_amount_positive;
ALTER TABLE fin_account DROP CONSTRAINT fin_account_type_valid;
UPDATE fin_account SET type = 'CORRENTE' WHERE type = 'BENEFICIO';
ALTER TABLE fin_account DROP COLUMN credit_amount, DROP COLUMN credit_day, DROP COLUMN credits_from;
ALTER TABLE fin_account ADD CONSTRAINT fin_account_type_valid
  CHECK (type IN ('CORRENTE', 'POUPANCA', 'CARTEIRA'));
