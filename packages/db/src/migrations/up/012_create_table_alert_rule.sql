create type alert_scope as enum ('global', 'per_portfolio');

-- Regras marcadas "da carteira" leem o limite de portfolio, não daqui.
create table alert_rule (
  kind      text primary key,
  enabled   boolean not null default true,
  threshold jsonb,
  scope     alert_scope not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger alert_rule_set_updated_at
  before update on alert_rule
  for each row execute function set_updated_at();
