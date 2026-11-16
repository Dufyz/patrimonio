ALTER TABLE portfolio
  DROP CONSTRAINT portfolio_strategy_tolerance_range,
  DROP CONSTRAINT portfolio_expected_return_range,
  DROP COLUMN expected_return_pct,
  DROP COLUMN strategy_tolerance_pp;
