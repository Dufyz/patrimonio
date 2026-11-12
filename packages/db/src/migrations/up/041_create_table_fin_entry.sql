CREATE TABLE fin_entry (
  id                   UUID PRIMARY KEY,
  kind                 TEXT NOT NULL,
  description          TEXT NOT NULL,
  date                 DATE NOT NULL,
  category_id          UUID NOT NULL REFERENCES fin_category (id),
  amount               NUMERIC(18,2) NOT NULL,
  status               TEXT NOT NULL,
  recurring_id         UUID REFERENCES fin_recurring (id) ON DELETE SET NULL,
  installment_group_id UUID,
  installment_no       INTEGER,
  installment_total    INTEGER,
  installment_origin   DATE,
  note                 TEXT,
  event_id             UUID,
  version              INTEGER NOT NULL DEFAULT 1,
  is_demo              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fin_entry_kind_valid CHECK (kind IN ('RECEITA', 'DESPESA')),
  CONSTRAINT fin_entry_status_valid CHECK (status IN ('PREVISTA', 'LANCADA')),
  CONSTRAINT fin_entry_amount_positive CHECK (amount > 0),
  CONSTRAINT fin_entry_description_not_blank CHECK (BTRIM(description) <> ''),
  CONSTRAINT fin_entry_installment_together CHECK (
    (installment_group_id IS NULL AND installment_no IS NULL AND installment_total IS NULL AND installment_origin IS NULL)
    OR (installment_group_id IS NOT NULL AND installment_no BETWEEN 1 AND installment_total
        AND installment_total BETWEEN 2 AND 60 AND installment_origin IS NOT NULL)
  )
);

CREATE INDEX fin_entry_date_idx ON fin_entry (date);
CREATE INDEX fin_entry_event_idx ON fin_entry (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX fin_entry_category_date_idx ON fin_entry (category_id, date);
CREATE INDEX fin_entry_recurring_date_idx ON fin_entry (recurring_id, date);
CREATE INDEX fin_entry_installment_idx ON fin_entry (installment_group_id, installment_no);
CREATE INDEX fin_entry_description_trgm_idx ON fin_entry USING GIN (description gin_trgm_ops);

-- Um previsto por recorrente e mês: a geração diária é idempotente mesmo sob corrida.
CREATE UNIQUE INDEX fin_entry_recurring_month_idx
  ON fin_entry (recurring_id, (EXTRACT(YEAR FROM date) * 100 + EXTRACT(MONTH FROM date)))
  WHERE recurring_id IS NOT NULL;

CREATE TRIGGER fin_entry_set_updated_at
  BEFORE UPDATE ON fin_entry
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
