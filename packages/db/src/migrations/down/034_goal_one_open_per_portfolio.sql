DROP INDEX IF EXISTS goal_portfolio_open_idx;

CREATE UNIQUE INDEX goal_name_open_idx ON goal (portfolio_id, LOWER(name)) WHERE closed_at IS NULL;
