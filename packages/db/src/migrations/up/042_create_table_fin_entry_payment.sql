CREATE TABLE fin_entry_payment (
  id            UUID PRIMARY KEY,
  entry_id      UUID NOT NULL REFERENCES fin_entry (id) ON DELETE CASCADE,
  source_type   TEXT NOT NULL,
  source_id     UUID NOT NULL,
  amount        NUMERIC(18,2) NOT NULL,
  position      INTEGER NOT NULL,
  -- Fatura em que a parte de cartão caiu, gravada no lançamento: mudar o
  -- fechamento do cartão não reescreve compras antigas.
  invoice_month TEXT,
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fin_entry_payment_source_type_valid CHECK (source_type IN ('CONTA', 'CARTAO')),
  CONSTRAINT fin_entry_payment_amount_positive CHECK (amount > 0),
  CONSTRAINT fin_entry_payment_position_valid CHECK (position IN (1, 2)),
  CONSTRAINT fin_entry_payment_invoice_valid CHECK (
    (source_type = 'CARTAO' AND invoice_month ~ '^[0-9]{4}-[0-9]{2}$')
    OR (source_type = 'CONTA' AND invoice_month IS NULL)
  ),
  UNIQUE (entry_id, position)
);

CREATE INDEX fin_entry_payment_source_idx ON fin_entry_payment (source_type, source_id);

-- A soma das partes é o valor do lançamento. Verificada no fim da transação,
-- porque as partes são gravadas depois do lançamento.
CREATE FUNCTION fin_entry_payment_sum_check() RETURNS TRIGGER AS $$
DECLARE
  target UUID := COALESCE(NEW.entry_id, OLD.entry_id);
  total  NUMERIC(18,2);
  parts  NUMERIC(18,2);
BEGIN
  SELECT e.amount INTO total FROM fin_entry e WHERE e.id = target;
  IF total IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM(p.amount), 0) INTO parts FROM fin_entry_payment p WHERE p.entry_id = target;
  IF parts <> total THEN
    RAISE EXCEPTION 'a soma dos pagamentos (%) difere do valor do lançamento (%)', parts, total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER fin_entry_payment_sum_check
  AFTER INSERT OR UPDATE OR DELETE ON fin_entry_payment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fin_entry_payment_sum_check();
