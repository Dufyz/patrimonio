-- PRJ-06 · regra de aporte da projeção: valor fixo por mês, de um mês a outro.
-- Várias regras de uma carteira somam nos meses em que se sobrepõem.
CREATE TABLE projection_rule (
  id           UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
  amount       NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
  from_month   CHAR(7) NOT NULL CHECK (from_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  until_month  CHAR(7) CHECK (until_month IS NULL OR until_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT projection_rule_period CHECK (until_month IS NULL OR until_month >= from_month),
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX projection_rule_portfolio_idx ON projection_rule (portfolio_id);

CREATE TRIGGER projection_rule_set_updated_at
  BEFORE UPDATE ON projection_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
