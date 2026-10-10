CREATE TABLE institution (
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL,
  country    CHAR(2) NOT NULL DEFAULT 'BR',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_country_format CHECK (country ~ '^[A-Z]{2}$')
);

CREATE UNIQUE INDEX institution_name_idx ON institution (LOWER(name));

CREATE TRIGGER institution_set_updated_at
  BEFORE UPDATE ON institution
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
