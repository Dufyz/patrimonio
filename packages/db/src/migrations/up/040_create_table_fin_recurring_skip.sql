CREATE TABLE fin_recurring_skip (
  recurring_id UUID NOT NULL REFERENCES fin_recurring (id) ON DELETE CASCADE,
  month        TEXT NOT NULL,
  is_demo      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (recurring_id, month),
  CONSTRAINT fin_recurring_skip_month_valid CHECK (month ~ '^[0-9]{4}-[0-9]{2}$')
);
