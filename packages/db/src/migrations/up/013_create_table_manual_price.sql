-- Vale até a fonte automática voltar a responder para aquele ativo.
create table manual_price (
  asset_id   uuid not null references asset (id) on delete cascade,
  -- Preço só existe em dia útil.
  price_date date not null references business_day (calendar_date),
  price      numeric(20,8) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (asset_id, price_date),
  constraint manual_price_non_negative check (price >= 0)
);

create trigger manual_price_set_updated_at
  before update on manual_price
  for each row execute function set_updated_at();
