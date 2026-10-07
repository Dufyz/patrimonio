create type benchmark_kind as enum ('index', 'index_plus_rate', 'blend');
create type benchmark_rebalance as enum ('monthly', 'daily', 'never');

-- Benchmark composto não é tabela de série: é definição, calculada a partir de
-- index_quote na hora da leitura.
create table benchmark (
  id         uuid primary key,
  name       text not null,
  kind       benchmark_kind not null,
  definition jsonb not null,
  rebalance  benchmark_rebalance not null default 'never',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index benchmark_name_idx on benchmark (lower(name));

create trigger benchmark_set_updated_at
  before update on benchmark
  for each row execute function set_updated_at();
