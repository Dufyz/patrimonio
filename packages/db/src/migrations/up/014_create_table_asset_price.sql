CREATE TYPE price_source_kind AS ENUM ('primary', 'fallback', 'manual');

CREATE TABLE asset_price (
  asset_id    UUID NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
  price_date  DATE NOT NULL REFERENCES business_day (calendar_date),
  close       NUMERIC(20,8) NOT NULL,
  source      TEXT NOT NULL,
  source_kind price_source_kind NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (asset_id, price_date),
  CONSTRAINT asset_price_non_negative CHECK (close >= 0)
);

CREATE INDEX asset_price_date_idx ON asset_price (price_date);
