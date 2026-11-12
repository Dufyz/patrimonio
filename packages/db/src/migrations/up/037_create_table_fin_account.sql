CREATE TABLE fin_account (
  id             UUID PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  institution    TEXT,
  role           TEXT NOT NULL DEFAULT '',
  role_tag       TEXT,
  opening_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  opening_date   DATE NOT NULL,
  credit_amount  NUMERIC(18,2),
  credit_day     INTEGER,
  credits_from   DATE,
  archived       BOOLEAN NOT NULL DEFAULT FALSE,
  version        INTEGER NOT NULL DEFAULT 1,
  is_demo        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fin_account_type_valid CHECK (type IN ('CORRENTE', 'POUPANCA', 'CARTEIRA', 'BENEFICIO')),
  CONSTRAINT fin_account_name_not_blank CHECK (BTRIM(name) <> ''),
  CONSTRAINT fin_account_credit_day_valid CHECK (credit_day IS NULL OR credit_day BETWEEN 1 AND 31),
  CONSTRAINT fin_account_credit_amount_positive CHECK (credit_amount IS NULL OR credit_amount > 0),
  CONSTRAINT fin_account_credit_together CHECK (
    (credit_amount IS NULL AND credit_day IS NULL AND credits_from IS NULL)
    OR (credit_amount IS NOT NULL AND credit_day IS NOT NULL AND credits_from IS NOT NULL AND type = 'BENEFICIO')
  )
);

CREATE UNIQUE INDEX fin_account_name_idx ON fin_account (LOWER(name)) WHERE NOT archived;

CREATE TRIGGER fin_account_set_updated_at
  BEFORE UPDATE ON fin_account
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
