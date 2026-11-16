-- EST-03 · tolerância da Estratégia por carteira; PRJ-06 · rentabilidade anual esperada (%), só da projeção.
ALTER TABLE portfolio
  ADD COLUMN strategy_tolerance_pp NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
  ADD COLUMN expected_return_pct   NUMERIC(5, 2),
  ADD CONSTRAINT portfolio_expected_return_range
    CHECK (expected_return_pct IS NULL OR (expected_return_pct >= 0 AND expected_return_pct <= 100)),
  ADD CONSTRAINT portfolio_strategy_tolerance_range
    CHECK (strategy_tolerance_pp > 0 AND strategy_tolerance_pp <= 100);
