CREATE TYPE computed_price_kind AS ENUM ('fresh', 'stale', 'manual', 'missing');

CREATE TABLE position_daily (
  portfolio_id      UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
  asset_id          UUID NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
  position_date     DATE NOT NULL,
  quantity          NUMERIC(20,8) NOT NULL,
  avg_price         NUMERIC(20,8) NOT NULL,
  cost_basis        NUMERIC(20,2) NOT NULL,
  market_value      NUMERIC(20,2) NOT NULL,
  price_source_kind computed_price_kind NOT NULL,
  accrued_interest  NUMERIC(20,2) NOT NULL DEFAULT 0,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portfolio_id, asset_id, position_date)
) PARTITION BY RANGE (position_date);

DO $$
DECLARE
  year INTEGER;
BEGIN
  FOR year IN 2000..2035 LOOP
    EXECUTE FORMAT(
      'CREATE TABLE position_daily_%s PARTITION OF position_daily
         FOR VALUES FROM (%L) TO (%L)',
      year, year || '-01-01', (year + 1) || '-01-01'
    );
  END LOOP;
END;
$$;

CREATE INDEX position_daily_portfolio_date_idx
  ON position_daily (portfolio_id, position_date DESC);
CREATE INDEX position_daily_asset_date_idx
  ON position_daily (asset_id, position_date);
