DELETE FROM fin_movement WHERE kind IN ('APORTE', 'RESGATE', 'PROVENTO');
ALTER TABLE fin_movement DROP CONSTRAINT fin_movement_kind_valid;
ALTER TABLE fin_movement ADD CONSTRAINT fin_movement_kind_valid
  CHECK (kind IN ('TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA', 'AJUSTE'));
