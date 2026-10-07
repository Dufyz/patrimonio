-- Excluir mostra o impacto e deixa desfazer por alguns segundos. O desfazer
-- precisa restaurar o estado anterior inteiro — inclusive o id do lançamento,
-- para que nada que apontava para ele fique órfão —, então a linha excluída é
-- guardada inteira aqui até a janela fechar.
create table transaction_undo (
  id             uuid primary key,
  -- O lançamento excluído. Numa transferência, a primeira perna do grupo.
  transaction_id uuid not null,
  portfolio_id   uuid not null references portfolio (id) on delete cascade,
  -- As linhas excluídas, inteiras: restaurar é reinserir o que está aqui.
  payload        jsonb not null,
  -- De onde o recálculo recomeça ao restaurar.
  from_date      date not null,
  expires_at     timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index transaction_undo_transaction_idx on transaction_undo (transaction_id);
create index transaction_undo_expires_idx on transaction_undo (expires_at);
