-- A invariante que define a cota: num dia com net_flow diferente de zero,
-- quota_value não muda e quota_count absorve; nos demais, quota_count não muda.
-- O produto das duas colunas é sempre total_value.
create table portfolio_daily (
  portfolio_id             uuid not null references portfolio (id) on delete cascade,
  position_date            date not null,
  total_value              numeric(20,2) not null,
  net_flow                 numeric(20,2) not null default 0,
  income                   numeric(20,2) not null default 0,
  payouts                  numeric(20,2) not null default 0,
  quota_value              numeric(20,12) not null,
  quota_count              numeric(20,12) not null,
  cumulative_contributions numeric(20,2) not null default 0,
  computed_at              timestamptz not null default now(),
  primary key (portfolio_id, position_date),
  constraint portfolio_daily_quota_positive check (quota_value > 0 and quota_count >= 0)
);

create index portfolio_daily_portfolio_date_idx
  on portfolio_daily (portfolio_id, position_date);
