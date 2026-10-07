create type asset_origin as enum ('market', 'manual');
create type price_source as enum ('auto', 'manual');
create type indexer as enum ('cdi_pct', 'ipca_plus', 'prefixed', 'selic_plus');
create type liquidity_kind as enum ('daily', 'at_maturity', 'd_plus_n');
create type tax_regime as enum ('regressive', 'exempt');

-- Uma só tabela para ativo listado e título cadastrado à mão. A diferença está
-- em origin e nas colunas de renda fixa, nulas no ativo listado.
create table asset (
  id             uuid primary key,
  ticker         text not null,
  name           text not null,
  origin         asset_origin not null,
  category_id    uuid references category (id) on delete set null,
  sector         text,
  price_source   price_source not null default 'auto',
  issuer_id      uuid references institution (id) on delete restrict,
  indexer        indexer,
  rate           numeric(12,8),
  issued_at      date,
  maturity_date  date,
  liquidity      liquidity_kind,
  -- d_plus_n sem o n não diz nada.
  liquidity_days smallint,
  tax_regime     tax_regime,
  archived_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_ticker_unique unique (ticker),
  constraint asset_manual_has_issuer
    check (origin <> 'manual' or issuer_id is not null),
  constraint asset_liquidity_days_declared
    check (liquidity is distinct from 'd_plus_n' or liquidity_days is not null),
  constraint asset_maturity_after_issue
    check (maturity_date is null or issued_at is null or maturity_date >= issued_at)
);

-- Parcial porque só renda fixa tem vencimento: o índice não carrega 300 ações nulas.
create index asset_maturity_idx on asset (maturity_date) where maturity_date is not null;
create index asset_category_idx on asset (category_id) where category_id is not null;

create trigger asset_set_updated_at
  before update on asset
  for each row execute function set_updated_at();
