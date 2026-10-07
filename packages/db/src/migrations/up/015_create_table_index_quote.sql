-- Índices guardados como fator diário, não como percentual acumulado: o
-- retorno de qualquer janela é um produto de fatores.
create table index_quote (
  index_code   text not null,
  quote_date   date not null references business_day (calendar_date),
  daily_factor numeric(20,12) not null,
  raw_value    numeric(20,8),
  source       text not null,
  fetched_at   timestamptz not null default now(),
  primary key (index_code, quote_date),
  constraint index_quote_factor_positive check (daily_factor > 0)
);

create index index_quote_code_date_idx on index_quote (index_code, quote_date);
