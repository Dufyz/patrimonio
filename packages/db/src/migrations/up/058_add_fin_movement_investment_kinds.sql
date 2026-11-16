-- LIV-03 · o movimento da conta também registra aporte, resgate e provento.
ALTER TABLE fin_movement DROP CONSTRAINT fin_movement_kind_valid;
ALTER TABLE fin_movement ADD CONSTRAINT fin_movement_kind_valid
  CHECK (kind IN ('TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA', 'AJUSTE', 'APORTE', 'RESGATE', 'PROVENTO'));
