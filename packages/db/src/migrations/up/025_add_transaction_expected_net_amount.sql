-- O líquido que de fato caiu na conta pode ser diferente do previsto: imposto
-- retido a mais, arredondamento da corretora, provento anunciado e pago em
-- valores diferentes. Guardar o previsto ao lado do recebido deixa a diferença
-- visível em vez de sumir na edição.
alter table transaction add column expected_net_amount numeric(20,2);

alter table transaction add constraint transaction_expected_only_on_payout
  check (expected_net_amount is null or kind = 'payout');
