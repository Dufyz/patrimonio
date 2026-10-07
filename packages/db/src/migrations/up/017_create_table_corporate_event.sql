create type corporate_event_kind as enum ('split', 'reverse_split', 'bonus');

-- Evento corporativo não se aplica sozinho de propósito: um desdobramento com
-- data errada reescreve preço médio e resultado de todo o histórico.
create table corporate_event (
  id           uuid primary key,
  asset_id     uuid not null references asset (id) on delete cascade,
  kind         corporate_event_kind not null,
  record_date  date not null,
  ratio_from   numeric(20,8) not null,
  ratio_to     numeric(20,8) not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corporate_event_unique unique (asset_id, kind, record_date),
  constraint corporate_event_ratios_positive check (ratio_from > 0 and ratio_to > 0)
);

create index corporate_event_unconfirmed_idx
  on corporate_event (record_date) where confirmed_at is null;

create trigger corporate_event_set_updated_at
  before update on corporate_event
  for each row execute function set_updated_at();
