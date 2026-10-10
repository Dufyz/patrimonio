CREATE TYPE institution_role AS ENUM ('custodian', 'issuer', 'both');

CREATE TABLE institution (
  id                  UUID PRIMARY KEY,
  name                TEXT NOT NULL,
  role                institution_role NOT NULL,
  fgc_covered         BOOLEAN NOT NULL DEFAULT FALSE,
  brokerage_per_order NUMERIC(20,2) NOT NULL DEFAULT 0,
  custody_monthly_fee NUMERIC(20,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_fees_non_negative
    CHECK (brokerage_per_order >= 0 AND custody_monthly_fee >= 0)
);

CREATE UNIQUE INDEX institution_name_idx ON institution (LOWER(name));

CREATE TRIGGER institution_set_updated_at
  BEFORE UPDATE ON institution
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
