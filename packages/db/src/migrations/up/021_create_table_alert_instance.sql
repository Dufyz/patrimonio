CREATE TYPE alert_status AS ENUM ('open', 'snoozed', 'ignored');

CREATE TABLE alert_instance (
  rule_kind     TEXT NOT NULL REFERENCES alert_rule (kind) ON DELETE CASCADE,
  subject_id    TEXT NOT NULL,
  portfolio_id  UUID REFERENCES portfolio (id) ON DELETE CASCADE,
  status        alert_status NOT NULL DEFAULT 'open',
  snooze_until  DATE,
  payload       JSONB NOT NULL DEFAULT '{}'::JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rule_kind, subject_id),
  CONSTRAINT alert_instance_snooze_declared
    CHECK (status <> 'snoozed' OR snooze_until IS NOT NULL)
);

CREATE INDEX alert_instance_status_idx ON alert_instance (status, snooze_until);
CREATE INDEX alert_instance_portfolio_idx
  ON alert_instance (portfolio_id) WHERE portfolio_id IS NOT NULL;

CREATE TRIGGER alert_instance_set_updated_at
  BEFORE UPDATE ON alert_instance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
