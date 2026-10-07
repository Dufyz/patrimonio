create type pipeline_stage as enum (
  'recalc', 'market', 'close', 'alerts', 'import', 'backup'
);

-- O pedido de trabalho é gravado aqui na mesma transação do estado que o
-- origina. O BullMQ é o transporte; o Postgres é a fonte da verdade, e por isso
-- o histórico de execução sobrevive a um FLUSHALL.
create table pipeline_outbox (
  id             uuid primary key,
  stage          pipeline_stage not null,
  dedupe_key     text not null,
  payload        jsonb not null,
  -- Atraso: o relay só despacha a partir daqui.
  available_at   timestamptz not null default now(),
  -- Teto da espera renovada, contado do primeiro pedido da rajada.
  debounce_until timestamptz,
  dispatched_at  timestamptz,
  started_at     timestamptz,
  completed_at   timestamptz,
  failed_at      timestamptz,
  attempts       integer not null default 0,
  error          text,
  -- O requestId que originou o pedido: é o que liga o clique ao job, seis
  -- meses depois, na pergunta "por que esse número está estranho".
  origin_request_id text,
  created_at     timestamptz not null default now()
);

-- Coalescência: no máximo um pendente por chave. Lançar cinco operações
-- seguidas na mesma carteira produz um recálculo, não cinco.
create unique index pipeline_outbox_pending_key_idx
  on pipeline_outbox (dedupe_key)
  where dispatched_at is null and failed_at is null;

create index pipeline_outbox_pending_idx
  on pipeline_outbox (available_at, created_at)
  where dispatched_at is null and failed_at is null;

create index pipeline_outbox_stage_completed_idx
  on pipeline_outbox (stage, completed_at desc)
  where completed_at is not null;

create index pipeline_outbox_failed_idx
  on pipeline_outbox (failed_at desc) where failed_at is not null;
