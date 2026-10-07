create type computed_price_kind as enum ('fresh', 'stale', 'manual', 'missing');

-- Uma linha por ativo, carteira e dia. Escrever todos os dias é deliberado:
-- guardar só os dias com movimento tornaria cada tela um LATERAL JOIN com
-- busca do último valor anterior.
--
-- A partição por ano nasce aqui, na primeira migration: mudar isso depois
-- exige reescrever a tabela inteira.
create table position_daily (
  portfolio_id      uuid not null references portfolio (id) on delete cascade,
  asset_id          uuid not null references asset (id) on delete cascade,
  position_date     date not null,
  quantity          numeric(20,8) not null,
  avg_price         numeric(20,8) not null,
  cost_basis        numeric(20,2) not null,
  market_value      numeric(20,2) not null,
  price_source_kind computed_price_kind not null,
  accrued_interest  numeric(20,2) not null default 0,
  computed_at       timestamptz not null default now(),
  primary key (portfolio_id, asset_id, position_date)
) partition by range (position_date);

do $$
declare
  year integer;
begin
  for year in 2000..2035 loop
    execute format(
      'create table position_daily_%s partition of position_daily
         for values from (%L) to (%L)',
      year, year || '-01-01', (year + 1) || '-01-01'
    );
  end loop;
end;
$$;

create index position_daily_portfolio_date_idx
  on position_daily (portfolio_id, position_date desc);
create index position_daily_asset_date_idx
  on position_daily (asset_id, position_date);
