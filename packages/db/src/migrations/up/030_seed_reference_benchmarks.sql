-- O que a tela de Desempenho compara a carteira contra. Benchmark é dado de
-- referência, não dado de uso: sem estes cinco, o gráfico abre sem nada contra o
-- que medir, e o usuário descobre pela ausência — no dia em que mais precisa de
-- uma régua.
--
-- Cada um é um índice simples sobre uma série que `index_quote` já guarda como
-- fator diário. Os compostos, como `IPCA + 6%` e `50% CDI + 50% IBOV`, são
-- definição do usuário e nascem em Configurações; este seed não os adivinha.
--
-- Os identificadores são fixos: o seed roda em todo ambiente, e um id gerado a
-- cada execução faria o mesmo benchmark ter identificadores diferentes entre o
-- banco de desenvolvimento e o de produção — e o link de uma tela com o
-- benchmark escolhido na URL deixaria de abrir o mesmo gráfico.
INSERT INTO benchmark (id, name, kind, definition, rebalance)
VALUES
  ('019b0000-0000-7000-8000-000000000001', 'CDI', 'index', '{"index": "CDI"}'::jsonb, 'never'),
  ('019b0000-0000-7000-8000-000000000002', 'Selic', 'index', '{"index": "SELIC"}'::jsonb, 'never'),
  ('019b0000-0000-7000-8000-000000000003', 'IPCA', 'index', '{"index": "IPCA"}'::jsonb, 'never'),
  ('019b0000-0000-7000-8000-000000000004', 'Ibovespa', 'index', '{"index": "IBOV"}'::jsonb, 'never'),
  ('019b0000-0000-7000-8000-000000000005', 'IFIX', 'index', '{"index": "IFIX"}'::jsonb, 'never')
ON CONFLICT ((lower(name))) DO NOTHING;
