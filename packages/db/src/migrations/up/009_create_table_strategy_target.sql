create table strategy_target (
  portfolio_id uuid not null references portfolio (id) on delete cascade,
  category_id  uuid not null references category (id) on delete restrict,
  target_pct   numeric(6,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (portfolio_id, category_id),
  constraint strategy_target_pct_range check (target_pct > 0 and target_pct <= 100)
);

-- A restrição que impede salvar uma estratégia que não fecha. Diferida: as
-- linhas entram uma a uma, e a soma só precisa valer no commit.
create or replace function assert_strategy_targets_sum_100() returns trigger
language plpgsql as $$
declare
  scope uuid := coalesce(new.portfolio_id, old.portfolio_id);
  total numeric(9,2);
begin
  select coalesce(sum(target_pct), 0) into total
    from strategy_target where portfolio_id = scope;

  -- Zero significa "sem estratégia definida", que é um estado legítimo.
  if total <> 0 and total <> 100 then
    raise exception 'alvo de estratégia da carteira % soma %, e precisa somar 100',
      scope, total using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger strategy_target_sums_100
  after insert or update or delete on strategy_target
  deferrable initially deferred
  for each row execute function assert_strategy_targets_sum_100();

create trigger strategy_target_set_updated_at
  before update on strategy_target
  for each row execute function set_updated_at();
