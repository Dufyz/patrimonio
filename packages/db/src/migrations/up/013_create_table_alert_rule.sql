CREATE TYPE alert_scope AS ENUM ('global', 'per_portfolio');

CREATE TABLE alert_rule (
  kind      TEXT PRIMARY KEY,
  enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  threshold JSONB,
  scope     alert_scope NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER alert_rule_set_updated_at
  BEFORE UPDATE ON alert_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
