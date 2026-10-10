CREATE TABLE goal_portfolio (
  goal_id      UUID NOT NULL REFERENCES goal (id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (goal_id, portfolio_id)
);

CREATE INDEX goal_portfolio_portfolio_idx ON goal_portfolio (portfolio_id);
