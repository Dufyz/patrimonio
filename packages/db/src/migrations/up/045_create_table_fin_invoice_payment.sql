CREATE TABLE fin_invoice_payment (
  id            UUID PRIMARY KEY,
  card_id       UUID NOT NULL REFERENCES fin_card (id),
  invoice_month TEXT NOT NULL,
  account_id    UUID NOT NULL REFERENCES fin_account (id),
  date          DATE NOT NULL,
  amount        NUMERIC(18,2) NOT NULL,
  -- Pagamento anterior ao período acompanhado: já está contido no saldo inicial.
  posted        BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fin_invoice_payment_amount_positive CHECK (amount > 0),
  CONSTRAINT fin_invoice_payment_invoice_valid CHECK (invoice_month ~ '^[0-9]{4}-[0-9]{2}$')
);

CREATE INDEX fin_invoice_payment_invoice_idx ON fin_invoice_payment (card_id, invoice_month);
CREATE INDEX fin_invoice_payment_account_idx ON fin_invoice_payment (account_id, date);
