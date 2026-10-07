create type price_source_kind as enum ('primary', 'fallback', 'manual');

-- Tabela de ingestão: carrega fetched_at e não tem updated_at, porque é
-- reescrita inteira em vez de editada.
create table asset_price (
  asset_id    uuid not null references asset (id) on delete cascade,
  price_date  date not null references business_day (calendar_date),
  close       numeric(20,8) not null,
  source      text not null,
  source_kind price_source_kind not null,
  -- Alimenta o alerta de preço atrasado.
  fetched_at  timestamptz not null default now(),
  primary key (asset_id, price_date),
  constraint asset_price_non_negative check (close >= 0)
);

create index asset_price_date_idx on asset_price (price_date);
