create table realized_result (
  transaction_id uuid primary key references transaction (id) on delete cascade,
  portfolio_id   uuid not null references portfolio (id) on delete cascade,
  asset_id       uuid not null references asset (id) on delete cascade,
  trade_date     date not null,
  proceeds       numeric(20,2) not null,
  cost_consumed  numeric(20,2) not null,
  result         numeric(20,2) not null,
  -- Isenção de R$ 20 mil em ações.
  exempt         boolean not null default false,
  loss_offset    numeric(20,2) not null default 0,
  computed_at    timestamptz not null default now()
);

create index realized_result_portfolio_date_idx
  on realized_result (portfolio_id, trade_date);
create index realized_result_asset_idx on realized_result (asset_id, trade_date);
