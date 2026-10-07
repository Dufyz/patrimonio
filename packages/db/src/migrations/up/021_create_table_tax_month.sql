create type asset_class as enum ('stock', 'fii', 'etf');

create table tax_month (
  year                 smallint not null,
  month                smallint not null,
  asset_class          asset_class not null,
  -- Soma das vendas do mês, para a regra dos R$ 20 mil.
  sales_total          numeric(20,2) not null default 0,
  gross_result         numeric(20,2) not null default 0,
  exempt               boolean not null default false,
  loss_carried_forward numeric(20,2) not null default 0,
  computed_at          timestamptz not null default now(),
  primary key (year, month, asset_class),
  constraint tax_month_month_range check (month between 1 and 12),
  constraint tax_month_year_range check (year between 2000 and 2100)
);
