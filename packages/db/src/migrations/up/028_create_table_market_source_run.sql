create type market_run_kind as enum (
  'quotes', 'indices', 'treasury', 'backfill', 'cotahist', 'contract_check'
);

-- Uma linha por execução de coleta, por fonte. É a única tabela que E4
-- acrescenta, e ela responde cinco perguntas que não são deriváveis de
-- asset_price: qual fonte respondeu por último, quantas requisições foram
-- consumidas no mês, qual foi a última falha e com que mensagem, quando a
-- bateria de contrato rodou contra a API real, e o que ela encontrou.
--
-- Tabela de registro, não de projeção: carrega finished_at e não updated_at,
-- porque a linha nasce pronta e nunca é editada.
create table market_source_run (
  id             uuid primary key,
  source         text not null,
  kind           market_run_kind not null,
  -- A data coletada. Nula na bateria de contrato, que não coleta nada.
  reference_date date,
  started_at     timestamptz not null,
  finished_at    timestamptz not null,
  ok             boolean not null,
  -- Quem respondeu: principal, alternativa, ou nenhuma das duas.
  source_kind    price_source_kind,
  -- Requisições consumidas, para o orçamento mensal do plano gratuito.
  requests       integer not null default 0,
  -- Linhas gravadas e papéis sem preço, que é a cobertura da coleta.
  items          integer not null default 0,
  missing        integer not null default 0,
  -- A mensagem do erro, que é o que a tela mostra em vez de um código.
  error          text,
  -- O campo e o trecho recebido, quando o formato mudou.
  detail         jsonb,
  created_at     timestamptz not null default now(),
  constraint market_source_run_finished_after_started
    check (finished_at >= started_at),
  constraint market_source_run_counts_non_negative
    check (requests >= 0 and items >= 0 and missing >= 0),
  -- Falha sem mensagem não serve para nada na tela de dados de mercado.
  constraint market_source_run_failure_explains
    check (ok or error is not null)
);

-- A situação de cada fonte é a última linha dela: o índice existe para essa
-- consulta não varrer o histórico inteiro.
create index market_source_run_source_idx
  on market_source_run (source, finished_at desc);

create index market_source_run_kind_idx
  on market_source_run (kind, finished_at desc);

-- O consumo do mês soma por fonte num intervalo.
create index market_source_run_requests_idx
  on market_source_run (source, started_at) where requests > 0;
