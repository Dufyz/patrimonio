create type institution_role as enum ('custodian', 'issuer', 'both');

create table institution (
  id                  uuid primary key,
  name                text not null,
  role                institution_role not null,
  fgc_covered         boolean not null default false,
  brokerage_per_order numeric(20,2) not null default 0,
  custody_monthly_fee numeric(20,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint institution_fees_non_negative
    check (brokerage_per_order >= 0 and custody_monthly_fee >= 0)
);

create unique index institution_name_idx on institution (lower(name));

create trigger institution_set_updated_at
  before update on institution
  for each row execute function set_updated_at();
