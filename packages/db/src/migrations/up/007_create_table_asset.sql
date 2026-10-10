CREATE TYPE asset_origin AS ENUM ('market', 'manual');
CREATE TYPE price_source AS ENUM ('auto', 'manual');
CREATE TYPE indexer AS ENUM ('cdi_pct', 'ipca_plus', 'prefixed', 'selic_plus');
CREATE TYPE liquidity_kind AS ENUM ('daily', 'at_maturity', 'd_plus_n');
CREATE TYPE tax_regime AS ENUM ('regressive', 'exempt');

CREATE TABLE asset (
  id             UUID PRIMARY KEY,
  ticker         TEXT NOT NULL,
  name           TEXT NOT NULL,
  origin         asset_origin NOT NULL,
  category_id    UUID REFERENCES category (id) ON DELETE SET NULL,
  sector         TEXT,
  price_source   price_source NOT NULL DEFAULT 'auto',
  issuer_id      UUID REFERENCES institution (id) ON DELETE RESTRICT,
  indexer        indexer,
  rate           NUMERIC(12,8),
  issued_at      DATE,
  maturity_date  DATE,
  liquidity      liquidity_kind,
  liquidity_days SMALLINT,
  tax_regime     tax_regime,
  archived_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT asset_ticker_unique UNIQUE (ticker),
  CONSTRAINT asset_manual_has_issuer
    CHECK (origin <> 'manual' OR issuer_id IS NOT NULL),
  CONSTRAINT asset_liquidity_days_declared
    CHECK (liquidity IS DISTINCT FROM 'd_plus_n' OR liquidity_days IS NOT NULL),
  CONSTRAINT asset_maturity_after_issue
    CHECK (maturity_date IS NULL OR issued_at IS NULL OR maturity_date >= issued_at)
);

CREATE INDEX asset_maturity_idx ON asset (maturity_date) WHERE maturity_date IS NOT NULL;
CREATE INDEX asset_category_idx ON asset (category_id) WHERE category_id IS NOT NULL;

CREATE TRIGGER asset_set_updated_at
  BEFORE UPDATE ON asset
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
