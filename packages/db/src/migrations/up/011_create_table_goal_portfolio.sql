-- O objetivo mede o valor das carteiras ligadas a ele: não guarda ativo
-- próprio, o que evita dividir uma posição entre dois objetivos.
create table goal_portfolio (
  goal_id      uuid not null references goal (id) on delete cascade,
  portfolio_id uuid not null references portfolio (id) on delete cascade,
  -- O vínculo é criado e removido, nunca editado: não tem updated_at.
  created_at   timestamptz not null default now(),
  primary key (goal_id, portfolio_id)
);

create index goal_portfolio_portfolio_idx on goal_portfolio (portfolio_id);
