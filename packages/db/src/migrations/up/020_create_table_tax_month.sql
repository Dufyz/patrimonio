CREATE TYPE asset_class AS ENUM ('stock', 'fii', 'etf');

CREATE TABLE tax_month (
  year                 SMALLINT NOT NULL,
  month                SMALLINT NOT NULL,
  asset_class          asset_class NOT NULL,
  sales_total          NUMERIC(20,2) NOT NULL DEFAULT 0,
  gross_result         NUMERIC(20,2) NOT NULL DEFAULT 0,
  exempt               BOOLEAN NOT NULL DEFAULT FALSE,
  loss_carried_forward NUMERIC(20,2) NOT NULL DEFAULT 0,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (year, month, asset_class),
  CONSTRAINT tax_month_month_range CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT tax_month_year_range CHECK (year BETWEEN 2000 AND 2100)
);
