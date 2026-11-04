CREATE TABLE category (
  id         UUID PRIMARY KEY,
  parent_id  UUID REFERENCES category (id) ON DELETE RESTRICT,
  name       TEXT NOT NULL,
  color_token TEXT NOT NULL,
  auto_rule  JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT category_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX category_name_per_parent_idx
  ON category (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::UUID), LOWER(name));

CREATE INDEX category_parent_idx ON category (parent_id) WHERE parent_id IS NOT NULL;

CREATE OR REPLACE FUNCTION assert_category_two_levels() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM category c WHERE c.id = NEW.parent_id AND c.parent_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'category accepts two levels: the parent of %s already has a parent', NEW.name
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER category_two_levels
  BEFORE INSERT OR UPDATE ON category
  FOR EACH ROW EXECUTE FUNCTION assert_category_two_levels();

CREATE TRIGGER category_set_updated_at
  BEFORE UPDATE ON category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
