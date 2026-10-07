create type transaction_kind as enum (
  'buy', 'sell', 'payout', 'deposit', 'withdrawal', 'transfer', 'corporate_event'
);
create type payout_kind as enum ('dividend', 'jcp', 'income', 'interest', 'amortization');

-- A tabela mais importante do sistema: é a única em que uma linha errada muda o
-- patrimônio de todas as datas seguintes.
create table transaction (
  id                uuid primary key,
  kind              transaction_kind not null,
  trade_date        date not null,
  settlement_date   date not null,
  portfolio_id      uuid not null references portfolio (id) on delete restrict,
  asset_id          uuid references asset (id) on delete restrict,
  institution_id    uuid not null references institution (id) on delete restrict,
  quantity          numeric(20,8) not null default 0,
  unit_price        numeric(20,8) not null default 0,
  fees              numeric(20,2) not null default 0,
  gross_amount      numeric(20,2) not null default 0,
  tax_withheld      numeric(20,2) not null default 0,
  net_amount        numeric(20,2) not null,
  payout_kind       payout_kind,
  record_date       date,
  -- Nulo enquanto o provento está "a receber".
  confirmed_at      timestamptz,
  transfer_group_id uuid,
  event_ratio_from  numeric(20,8),
  event_ratio_to    numeric(20,8),
  note              text,
  -- Clique duplo no botão de salvar não gera dois lançamentos.
  idempotency_key   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transaction_asset_required
    check (kind in ('deposit', 'withdrawal') or asset_id is not null),
  constraint transaction_payout_has_kind
    check (kind <> 'payout' or payout_kind is not null),
  constraint transaction_transfer_has_group
    check (kind <> 'transfer' or transfer_group_id is not null),
  constraint transaction_event_has_ratio
    check (kind <> 'corporate_event'
           or (event_ratio_from is not null and event_ratio_to is not null)),
  constraint transaction_ratios_positive
    check ((event_ratio_from is null or event_ratio_from > 0)
           and (event_ratio_to is null or event_ratio_to > 0)),
  constraint transaction_quantity_non_negative check (quantity >= 0),
  constraint transaction_unit_price_non_negative check (unit_price >= 0),
  constraint transaction_fees_non_negative check (fees >= 0),
  constraint transaction_settlement_not_before_trade
    check (settlement_date >= trade_date)
);

create index transaction_portfolio_trade_date_idx
  on transaction (portfolio_id, trade_date desc);
create index transaction_asset_trade_date_idx
  on transaction (asset_id, trade_date) where asset_id is not null;
create index transaction_transfer_group_idx
  on transaction (transfer_group_id) where transfer_group_id is not null;
create index transaction_pending_payout_idx
  on transaction (portfolio_id, settlement_date)
  where kind = 'payout' and confirmed_at is null;
create unique index transaction_idempotency_idx
  on transaction (idempotency_key) where idempotency_key is not null;

-- Transferência preserva patrimônio: duas pernas, nunca uma.
create or replace function assert_transfer_has_two_legs() returns trigger
language plpgsql as $$
declare
  group_id uuid := coalesce(new.transfer_group_id, old.transfer_group_id);
  legs integer;
begin
  if group_id is null then
    return null;
  end if;

  select count(*) into legs from transaction where transfer_group_id = group_id;

  if legs not in (0, 2) then
    raise exception 'transferência % tem % perna(s), e precisa de exatamente 2',
      group_id, legs using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger transaction_transfer_two_legs
  after insert or update or delete on transaction
  deferrable initially deferred
  for each row execute function assert_transfer_has_two_legs();

create trigger transaction_set_updated_at
  before update on transaction
  for each row execute function set_updated_at();
