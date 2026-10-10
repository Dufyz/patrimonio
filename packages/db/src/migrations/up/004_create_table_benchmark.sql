CREATE TYPE benchmark_kind AS ENUM ('index', 'index_plus_rate', 'blend');
CREATE TYPE benchmark_rebalance AS ENUM ('monthly', 'daily', 'never');

CREATE TABLE benchmark (
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       benchmark_kind NOT NULL,
  definition JSONB NOT NULL,
  rebalance  benchmark_rebalance NOT NULL DEFAULT 'never',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX benchmark_name_idx ON benchmark (LOWER(name));

CREATE TRIGGER benchmark_set_updated_at
  BEFORE UPDATE ON benchmark
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
