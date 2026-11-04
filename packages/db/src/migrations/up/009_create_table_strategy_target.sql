CREATE TABLE strategy_target (
  portfolio_id UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES category (id) ON DELETE RESTRICT,
  target_pct   NUMERIC(6,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portfolio_id, category_id),
  CONSTRAINT strategy_target_pct_range CHECK (target_pct > 0 AND target_pct <= 100)
);

CREATE OR REPLACE FUNCTION assert_strategy_targets_sum_100() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  scope UUID := COALESCE(NEW.portfolio_id, OLD.portfolio_id);
  total NUMERIC(9,2);
BEGIN
  SELECT COALESCE(SUM(target_pct), 0) INTO total
    FROM strategy_target WHERE portfolio_id = scope;

  IF total <> 0 AND total <> 100 THEN
    RAISE EXCEPTION 'alvo de estratégia da carteira % soma %, e precisa somar 100',
      scope, total USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER strategy_target_sums_100
  AFTER INSERT OR UPDATE OR DELETE ON strategy_target
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_strategy_targets_sum_100();

CREATE TRIGGER strategy_target_set_updated_at
  BEFORE UPDATE ON strategy_target
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
