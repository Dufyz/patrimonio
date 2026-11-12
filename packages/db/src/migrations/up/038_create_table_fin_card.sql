CREATE TABLE fin_card (
  id             UUID PRIMARY KEY,
  name           TEXT NOT NULL,
  last4          TEXT NOT NULL DEFAULT '',
  pay_account_id UUID NOT NULL REFERENCES fin_account (id),
  limit_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
  closing_day    INTEGER NOT NULL,
  due_day        INTEGER NOT NULL,
  archived       BOOLEAN NOT NULL DEFAULT FALSE,
  version        INTEGER NOT NULL DEFAULT 1,
  is_demo        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fin_card_name_not_blank CHECK (BTRIM(name) <> ''),
  CONSTRAINT fin_card_closing_day_valid CHECK (closing_day BETWEEN 1 AND 31),
  CONSTRAINT fin_card_due_day_valid CHECK (due_day BETWEEN 1 AND 31),
  CONSTRAINT fin_card_limit_not_negative CHECK (limit_amount >= 0)
);

CREATE INDEX fin_card_pay_account_idx ON fin_card (pay_account_id);

CREATE TRIGGER fin_card_set_updated_at
  BEFORE UPDATE ON fin_card
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
