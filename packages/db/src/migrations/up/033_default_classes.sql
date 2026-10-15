-- As cinco classes padrão da estratégia: Ações, Ações internacionais, Renda fixa,
-- Fundos imobiliários e Outros. "Alternativos" deixa de existir e o que havia nele
-- (COE, Commodities, Criptomoedas, Futuros, Moedas) passa para "Outros".
UPDATE category
   SET name = 'Ações internacionais'
 WHERE id = '01960000-0002-7000-8000-000000000021'
   AND NOT EXISTS (
     SELECT 1 FROM category other
      WHERE other.parent_id IS NULL AND LOWER(other.name) = LOWER('Ações internacionais')
   );

UPDATE category
   SET parent_id = '01960000-0002-7000-8000-000000000025'
 WHERE parent_id = '01960000-0002-7000-8000-000000000023';

-- Quem tinha alvo em Alternativos soma esse alvo ao de Outros: o total da
-- estratégia continua fechando 100.
INSERT INTO strategy_target (portfolio_id, category_id, target_pct)
SELECT portfolio_id, '01960000-0002-7000-8000-000000000025', target_pct
  FROM strategy_target
 WHERE category_id = '01960000-0002-7000-8000-000000000023'
ON CONFLICT (portfolio_id, category_id)
  DO UPDATE SET target_pct = strategy_target.target_pct + EXCLUDED.target_pct;

DELETE FROM strategy_target
 WHERE category_id = '01960000-0002-7000-8000-000000000023';

UPDATE asset
   SET category_id = '01960000-0002-7000-8000-000000000025'
 WHERE category_id = '01960000-0002-7000-8000-000000000023';

DELETE FROM category WHERE id = '01960000-0002-7000-8000-000000000023';
