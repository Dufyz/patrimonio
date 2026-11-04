-- Item que só existe na fatura (RN-46): compra resumida, parcela de compra
-- antiga, crédito ou encargo. A compra lançada em Lançamentos não vem para cá.
CREATE TABLE fin_card_item (
  id                 UUID PRIMARY KEY,
  card_id            UUID NOT NULL REFERENCES fin_card (id),
  kind               TEXT NOT NULL,
  subtype            TEXT,
  purchase_date      DATE NOT NULL,
  invoice_month      TEXT NOT NULL,
  description        TEXT NOT NULL,
  category_id        UUID REFERENCES fin_category (id),
  amount             NUMERIC(18,2) NOT NULL,
  installment_group_id UUID,
  installment_no     INTEGER,
  installment_total  INTEGER,
  installment_origin DATE,
  version            INTEGER NOT NULL DEFAULT 1,
  is_demo            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fin_card_item_kind_valid CHECK (kind IN ('COMPRA', 'CREDITO', 'ENCARGO')),
  CONSTRAINT fin_card_item_amount_positive CHECK (amount > 0),
  CONSTRAINT fin_card_item_invoice_valid CHECK (invoice_month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT fin_card_item_installment_together CHECK (
    (installment_group_id IS NULL AND installment_no IS NULL AND installment_total IS NULL AND installment_origin IS NULL)
    OR (installment_group_id IS NOT NULL AND installment_no BETWEEN 1 AND installment_total
        AND installment_total BETWEEN 2 AND 60 AND installment_origin IS NOT NULL)
  )
);

CREATE INDEX fin_card_item_invoice_idx ON fin_card_item (card_id, invoice_month);

CREATE TRIGGER fin_card_item_set_updated_at
  BEFORE UPDATE ON fin_card_item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
