-- "Não foi pago" tira o provento do livro, e o motivo precisa sobreviver a
-- isso: sem este registro, um provento que some não tem explicação seis meses
-- depois — e a dúvida volta toda vez que a fonte anunciar o mesmo pagamento.
create table payout_dismissal (
  id                  uuid primary key,
  portfolio_id        uuid not null references portfolio (id) on delete cascade,
  asset_id            uuid references asset (id) on delete set null,
  payout_kind         payout_kind not null,
  record_date         date not null,
  payment_date        date not null,
  expected_net_amount numeric(20,2) not null,
  reason              text not null,
  created_at timestamptz not null default now()
);

-- A tela de proventos descartados lê por ativo e data-com; o alerta de provento
-- anunciado lê a mesma chave para não reabrir o que já foi descartado.
create index payout_dismissal_asset_record_idx
  on payout_dismissal (asset_id, record_date);
create index payout_dismissal_portfolio_idx on payout_dismissal (portfolio_id);
