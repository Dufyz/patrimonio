CREATE TABLE fin_movement (
  id          UUID PRIMARY KEY,
  date        DATE NOT NULL,
  account_id  UUID NOT NULL REFERENCES fin_account (id),
  kind        TEXT NOT NULL,
  amount      NUMERIC(18,2) NOT NULL,
  description TEXT NOT NULL,
  note        TEXT,
  transfer_id UUID,
  is_demo     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fin_movement_kind_valid CHECK (kind IN ('CREDITO', 'TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA', 'AJUSTE')),
  CONSTRAINT fin_movement_amount_not_zero CHECK (amount <> 0),
  CONSTRAINT fin_movement_transfer_coherent CHECK (
    (kind IN ('TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA')) = (transfer_id IS NOT NULL)
  )
);

CREATE INDEX fin_movement_account_date_idx ON fin_movement (account_id, date);
CREATE INDEX fin_movement_transfer_idx ON fin_movement (transfer_id) WHERE transfer_id IS NOT NULL;

-- Um crédito por benefício e mês: a rotina diária pode repetir sem duplicar.
CREATE UNIQUE INDEX fin_movement_credit_month_idx
  ON fin_movement (account_id, (EXTRACT(YEAR FROM date) * 100 + EXTRACT(MONTH FROM date)))
  WHERE kind = 'CREDITO';

CREATE TRIGGER fin_movement_set_updated_at
  BEFORE UPDATE ON fin_movement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
