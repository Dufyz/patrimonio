create table announced_payout (
  id                          uuid primary key,
  asset_id                    uuid not null references asset (id) on delete cascade,
  payout_kind                 payout_kind not null,
  record_date                 date not null,
  payment_date                date,
  amount_per_share            numeric(20,8) not null,
  source                      text not null,
  -- Lançamento "a receber" gerado, quando havia posição na data-com.
  materialized_transaction_id uuid references transaction (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announced_payout_unique unique (asset_id, payout_kind, record_date),
  constraint announced_payout_amount_positive check (amount_per_share > 0)
);

create index announced_payout_payment_idx on announced_payout (payment_date);

create trigger announced_payout_set_updated_at
  before update on announced_payout
  for each row execute function set_updated_at();
