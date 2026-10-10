CREATE TYPE transaction_kind AS ENUM (
  'buy', 'sell', 'payout', 'deposit', 'withdrawal', 'transfer', 'corporate_event'
);
CREATE TYPE payout_kind AS ENUM ('dividend', 'jcp', 'income', 'interest', 'amortization');

CREATE TABLE transaction (
  id                UUID PRIMARY KEY,
  kind              transaction_kind NOT NULL,
  trade_date        DATE NOT NULL,
  settlement_date   DATE NOT NULL,
  portfolio_id      UUID NOT NULL REFERENCES portfolio (id) ON DELETE RESTRICT,
  asset_id          UUID REFERENCES asset (id) ON DELETE RESTRICT,
  institution_id    UUID NOT NULL REFERENCES institution (id) ON DELETE RESTRICT,
  quantity          NUMERIC(20,8) NOT NULL DEFAULT 0,
  unit_price        NUMERIC(20,8) NOT NULL DEFAULT 0,
  fees              NUMERIC(20,2) NOT NULL DEFAULT 0,
  gross_amount      NUMERIC(20,2) NOT NULL DEFAULT 0,
  tax_withheld      NUMERIC(20,2) NOT NULL DEFAULT 0,
  net_amount        NUMERIC(20,2) NOT NULL,
  payout_kind       payout_kind,
  record_date       DATE,
  confirmed_at      TIMESTAMPTZ,
  transfer_group_id UUID,
  event_ratio_from  NUMERIC(20,8),
  event_ratio_to    NUMERIC(20,8),
  note              TEXT,
  idempotency_key   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transaction_asset_required
    CHECK (kind IN ('deposit', 'withdrawal') OR asset_id IS NOT NULL),
  CONSTRAINT transaction_payout_has_kind
    CHECK (kind <> 'payout' OR payout_kind IS NOT NULL),
  CONSTRAINT transaction_transfer_has_group
    CHECK (kind <> 'transfer' OR transfer_group_id IS NOT NULL),
  CONSTRAINT transaction_event_has_ratio
    CHECK (kind <> 'corporate_event'
           OR (event_ratio_from IS NOT NULL AND event_ratio_to IS NOT NULL)),
  CONSTRAINT transaction_ratios_positive
    CHECK ((event_ratio_from IS NULL OR event_ratio_from > 0)
           AND (event_ratio_to IS NULL OR event_ratio_to > 0)),
  CONSTRAINT transaction_quantity_non_negative CHECK (quantity >= 0),
  CONSTRAINT transaction_unit_price_non_negative CHECK (unit_price >= 0),
  CONSTRAINT transaction_fees_non_negative CHECK (fees >= 0),
  CONSTRAINT transaction_settlement_not_before_trade
    CHECK (settlement_date >= trade_date)
);

CREATE INDEX transaction_portfolio_trade_date_idx
  ON transaction (portfolio_id, trade_date DESC);
CREATE INDEX transaction_asset_trade_date_idx
  ON transaction (asset_id, trade_date) WHERE asset_id IS NOT NULL;
CREATE INDEX transaction_transfer_group_idx
  ON transaction (transfer_group_id) WHERE transfer_group_id IS NOT NULL;
CREATE INDEX transaction_pending_payout_idx
  ON transaction (portfolio_id, settlement_date)
  WHERE kind = 'payout' AND confirmed_at IS NULL;
CREATE UNIQUE INDEX transaction_idempotency_idx
  ON transaction (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION assert_transfer_has_two_legs() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  group_id UUID := COALESCE(NEW.transfer_group_id, OLD.transfer_group_id);
  legs INTEGER;
BEGIN
  IF group_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO legs FROM transaction WHERE transfer_group_id = group_id;

  IF legs NOT IN (0, 2) THEN
    RAISE EXCEPTION 'transferência % tem % perna(s), e precisa de exatamente 2',
      group_id, legs USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transaction_transfer_two_legs
  AFTER INSERT OR UPDATE OR DELETE ON transaction
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transfer_has_two_legs();

CREATE TRIGGER transaction_set_updated_at
  BEFORE UPDATE ON transaction
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
