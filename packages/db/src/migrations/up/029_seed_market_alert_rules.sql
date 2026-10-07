-- `alert_instance.rule_kind` referencia `alert_rule.kind`, então a regra precisa
-- existir antes do primeiro alerta. As treze regras do painel entram em E7; as
-- três que a coleta de mercado abre entram aqui, porque é aqui que elas passam a
-- ser escritas.
--
-- Elas nascem ligadas e com o limite declarado em `threshold`. Regra desligada
-- não gera alerta nem consome processamento — a reconciliação a descarta antes de
-- qualquer leitura — e é por isso que o limite é configuração e não constante:
-- mudar a tolerância de preço atrasado não é deploy de código.
insert into alert_rule (kind, enabled, threshold, scope)
values
  -- Nunca houve preço para o papel: a posição entra pelo custo, e o usuário
  -- decide entre preço manual e aceitar a ressalva.
  ('price_missing', true, null, 'global'),
  -- Houve, e está velho. O número ainda é um número, só não é o de hoje.
  ('price_stale', true, '{"days": 3}'::jsonb, 'global'),
  -- Evento corporativo detectado espera confirmação: a quantidade em carteira
  -- não muda sozinha.
  ('corporate_event_pending', true, null, 'global')
on conflict (kind) do nothing;
