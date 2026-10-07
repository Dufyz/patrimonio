create type rebalance_mode as enum ('contributions_only', 'buy_and_sell');
create type recalc_status as enum ('idle', 'queued', 'running', 'failed');

create table portfolio (
  id                   uuid primary key,
  name                 text not null,
  purpose              text,
  benchmark_id         uuid references benchmark (id) on delete set null,
  tolerance_pp         numeric(6,2) not null default 5,
  max_asset_weight_pct numeric(6,2),
  rebalance_mode       rebalance_mode not null default 'contributions_only',
  review_every_months  smallint,
  sort_order           integer not null default 0,
  -- Escrito só pela máquina de estados do pipeline. Nenhuma rota o aceita no
  -- POST nem no PATCH.
  recalc_status        recalc_status not null default 'idle',
  recalc_from_date     date,
  recalc_error         text,
  recalc_updated_at    timestamptz,
  archived_at          timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_tolerance_range check (tolerance_pp >= 0 and tolerance_pp <= 100),
  constraint portfolio_max_weight_range
    check (max_asset_weight_pct is null
           or (max_asset_weight_pct > 0 and max_asset_weight_pct <= 100)),
  constraint portfolio_review_months_positive
    check (review_every_months is null or review_every_months > 0)
);

-- Único entre carteiras ativas: arquivar libera o nome e mantém o histórico.
create unique index portfolio_name_active_idx
  on portfolio (lower(name)) where archived_at is null;

create trigger portfolio_set_updated_at
  before update on portfolio
  for each row execute function set_updated_at();
