CREATE TABLE listed_instrument (
  id              UUID PRIMARY KEY,
  ticker          TEXT NOT NULL,
  name            TEXT NOT NULL,
  b3_type         TEXT NOT NULL,
  maturity_date   DATE,
  source          TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_trade_date DATE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT listed_instrument_ticker_unique UNIQUE (ticker),
  CONSTRAINT listed_instrument_ticker_upper CHECK (ticker = UPPER(ticker)),
  CONSTRAINT listed_instrument_b3_type_known
    CHECK (b3_type IN ('stock', 'fii', 'etf', 'bdr', 'treasury')),
  CONSTRAINT listed_instrument_treasury_matures
    CHECK ((b3_type = 'treasury') = (maturity_date IS NOT NULL))
);

CREATE INDEX listed_instrument_type_idx ON listed_instrument (b3_type, ticker) WHERE active;

CREATE TRIGGER listed_instrument_set_updated_at
  BEFORE UPDATE ON listed_instrument
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
