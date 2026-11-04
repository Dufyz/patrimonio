CREATE TABLE fin_category (
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  color      TEXT NOT NULL,
  archived   BOOLEAN NOT NULL DEFAULT FALSE,
  version    INTEGER NOT NULL DEFAULT 1,
  is_demo    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fin_category_kind_valid CHECK (kind IN ('RECEITA', 'DESPESA')),
  CONSTRAINT fin_category_name_not_blank CHECK (BTRIM(name) <> '')
);

CREATE UNIQUE INDEX fin_category_kind_name_idx ON fin_category (kind, LOWER(name));

CREATE TRIGGER fin_category_set_updated_at
  BEFORE UPDATE ON fin_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
