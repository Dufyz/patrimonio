create type alert_status as enum ('open', 'snoozed', 'ignored');

-- A única projeção com estado que o usuário mexe: adiar e ignorar. O motor
-- reconcilia por (rule_kind, subject_id) em vez de apagar e regravar, para esse
-- estado sobreviver ao recálculo.
create table alert_instance (
  rule_kind     text not null references alert_rule (kind) on delete cascade,
  subject_id    text not null,
  portfolio_id  uuid references portfolio (id) on delete cascade,
  status        alert_status not null default 'open',
  snooze_until  date,
  payload       jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (rule_kind, subject_id),
  constraint alert_instance_snooze_declared
    check (status <> 'snoozed' or snooze_until is not null)
);

create index alert_instance_status_idx on alert_instance (status, snooze_until);
create index alert_instance_portfolio_idx
  on alert_instance (portfolio_id) where portfolio_id is not null;

create trigger alert_instance_set_updated_at
  before update on alert_instance
  for each row execute function set_updated_at();
