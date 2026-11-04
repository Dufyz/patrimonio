-- As categorias que ficaram soltas no topo (Ativos Personalizados, ETFs e Fundos)
-- vão para um grupo, e toda linha de primeiro nível da estratégia passa a ser um
-- grupo: soltas, elas se misturavam aos grupos e a tela não dizia o que era o quê.
-- "ETFs" é onde o ETF novo cai até a pessoa escolher o lastro dele.
INSERT INTO category (id, parent_id, name, color_token, auto_rule, sort_order)
VALUES
  ('01960000-0002-7000-8000-000000000025', NULL, 'Outros', 'class.outros', NULL, 300)
ON CONFLICT (id) DO NOTHING;

UPDATE category
   SET parent_id = '01960000-0002-7000-8000-000000000025'
 WHERE id IN (
   '01960000-0002-7000-8000-000000000002', -- Ativos Personalizados
   '01960000-0002-7000-8000-00000000000e', -- ETFs
   '01960000-0002-7000-8000-000000000011'  -- Fundos
 );
