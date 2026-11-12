CREATE TABLE fin_recurring (
  id               UUID PRIMARY KEY,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  category_id      UUID REFERENCES fin_category (id),
  portfolio_id     UUID REFERENCES portfolio (id) ON DELETE CASCADE,
  asset_id         UUID REFERENCES asset (id) ON DELETE SET NULL,
  source_type      TEXT NOT NULL,
  source_id        UUID NOT NULL,
  split            BOOLEAN NOT NULL DEFAULT FALSE,
  second_source_type TEXT,
  second_source_id UUID,
  covers_up_to     NUMERIC(18,2),
  day              INTEGER NOT NULL,
  mode             TEXT NOT NULL,
  amount           NUMERIC(18,2) NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  version          INTEGER NOT NULL DEFAULT 1,
  is_demo          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fin_recurring_kind_valid CHECK (kind IN ('RECEITA', 'DESPESA', 'APORTE')),
  CONSTRAINT fin_recurring_mode_valid CHECK (mode IN ('MANUAL', 'AUTOMATICO')),
  CONSTRAINT fin_recurring_source_type_valid CHECK (source_type IN ('CONTA', 'CARTAO')),
  CONSTRAINT fin_recurring_second_source_type_valid CHECK (second_source_type IS NULL OR second_source_type IN ('CONTA', 'CARTAO')),
  CONSTRAINT fin_recurring_day_valid CHECK (day BETWEEN 1 AND 31),
  CONSTRAINT fin_recurring_amount_positive CHECK (amount > 0),
  CONSTRAINT fin_recurring_aporte_coherent CHECK (
    (kind = 'APORTE' AND category_id IS NULL AND portfolio_id IS NOT NULL
      AND source_type = 'CONTA' AND mode = 'MANUAL' AND NOT split)
    OR (kind <> 'APORTE' AND category_id IS NOT NULL AND portfolio_id IS NULL AND asset_id IS NULL)
  ),
  CONSTRAINT fin_recurring_split_coherent CHECK (
    (NOT split AND second_source_type IS NULL AND second_source_id IS NULL AND covers_up_to IS NULL)
    OR (split AND second_source_type IS NOT NULL AND second_source_id IS NOT NULL
        AND covers_up_to IS NOT NULL AND covers_up_to > 0 AND covers_up_to < amount
        AND NOT (second_source_type = source_type AND second_source_id = source_id))
  )
);

CREATE INDEX fin_recurring_category_idx ON fin_recurring (category_id);

CREATE TRIGGER fin_recurring_set_updated_at
  BEFORE UPDATE ON fin_recurring
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
