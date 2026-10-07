create table goal (
  id                  uuid primary key,
  name                text not null,
  target_amount       numeric(20,2) not null,
  target_date         date not null,
  return_assumption   text,
  -- Quando verdadeiro, a projeção corrige a meta pelo IPCA.
  amount_in_today_brl boolean not null default false,
  closed_at           timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_target_amount_positive check (target_amount > 0)
);

create unique index goal_name_open_idx on goal (lower(name)) where closed_at is null;

create trigger goal_set_updated_at
  before update on goal
  for each row execute function set_updated_at();
