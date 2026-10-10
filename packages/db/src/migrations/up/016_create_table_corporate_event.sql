CREATE TYPE corporate_event_kind AS ENUM ('split', 'reverse_split', 'bonus');

CREATE TABLE corporate_event (
  id           UUID PRIMARY KEY,
  asset_id     UUID NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
  kind         corporate_event_kind NOT NULL,
  record_date  DATE NOT NULL,
  ratio_from   NUMERIC(20,8) NOT NULL,
  ratio_to     NUMERIC(20,8) NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT corporate_event_unique UNIQUE (asset_id, kind, record_date),
  CONSTRAINT corporate_event_ratios_positive CHECK (ratio_from > 0 AND ratio_to > 0)
);

CREATE INDEX corporate_event_unconfirmed_idx
  ON corporate_event (record_date) WHERE confirmed_at IS NULL;

CREATE TRIGGER corporate_event_set_updated_at
  BEFORE UPDATE ON corporate_event
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
