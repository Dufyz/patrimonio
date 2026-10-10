CREATE TABLE goal (
  id                  UUID PRIMARY KEY,
  name                TEXT NOT NULL,
  target_amount       NUMERIC(20,2) NOT NULL,
  target_date         DATE NOT NULL,
  return_assumption   TEXT,
  amount_in_today_brl BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at           TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT goal_target_amount_positive CHECK (target_amount > 0)
);

CREATE UNIQUE INDEX goal_name_open_idx ON goal (LOWER(name)) WHERE closed_at IS NULL;

CREATE TRIGGER goal_set_updated_at
  BEFORE UPDATE ON goal
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
