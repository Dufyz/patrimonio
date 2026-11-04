CREATE TABLE manual_price (
  asset_id   UUID NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
  price_date DATE NOT NULL REFERENCES business_day (calendar_date),
  price      NUMERIC(20,8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (asset_id, price_date),
  CONSTRAINT manual_price_non_negative CHECK (price >= 0)
);

CREATE TRIGGER manual_price_set_updated_at
  BEFORE UPDATE ON manual_price
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
