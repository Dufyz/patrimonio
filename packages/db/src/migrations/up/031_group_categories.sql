-- Grupos de categoria, para a estratégia falar em classes: "25% em ações" vale para
-- Ações / Units e para ETF de ações, "25% em FIIs" para FIIs e ETF de FIIs. O
-- catálogo era plano; os ids das categorias não mudam (ativo e alvo seguem
-- apontando para elas), só ganham um grupo em `parent_id`.
INSERT INTO category (id, parent_id, name, color_token, auto_rule, sort_order)
VALUES
  ('01960000-0002-7000-8000-000000000020', NULL, 'Ações', 'class.acoes', NULL, 10),
  ('01960000-0002-7000-8000-000000000021', NULL, 'Internacional', 'class.bdr', NULL, 30),
  ('01960000-0002-7000-8000-000000000022', NULL, 'Renda fixa', 'class.rf-pos', NULL, 50),
  ('01960000-0002-7000-8000-000000000023', NULL, 'Alternativos', 'class.outros', NULL, 70),
  ('01960000-0002-7000-8000-000000000024', NULL, 'Fundos imobiliários', 'class.fiis', NULL, 160)
ON CONFLICT (id) DO NOTHING;

-- Os ETFs por tipo de lastro: o `b3_type` só diz "ETF", então quem escolhe a
-- categoria é a pessoa, no cadastro do ativo.
INSERT INTO category (id, parent_id, name, color_token, auto_rule, sort_order)
VALUES
  ('01960000-0002-7000-8000-000000000030', '01960000-0002-7000-8000-000000000020', 'ETF de ações', 'class.etf', NULL, 11),
  ('01960000-0002-7000-8000-000000000031', '01960000-0002-7000-8000-000000000024', 'ETF de FIIs', 'class.etf', NULL, 161),
  ('01960000-0002-7000-8000-000000000032', '01960000-0002-7000-8000-000000000022', 'ETF de renda fixa', 'class.etf', NULL, 51),
  ('01960000-0002-7000-8000-000000000033', '01960000-0002-7000-8000-000000000021', 'ETF internacional', 'class.etf', NULL, 31)
ON CONFLICT (id) DO NOTHING;

UPDATE category
   SET parent_id = '01960000-0002-7000-8000-000000000020'
 WHERE id IN (
   '01960000-0002-7000-8000-000000000001', -- Ações / Units
   '01960000-0002-7000-8000-00000000001d', -- Termo de Ações
   '01960000-0002-7000-8000-000000000018', -- Opções de Ações
   '01960000-0002-7000-8000-00000000000c', -- Direitos de Subscrição
   '01960000-0002-7000-8000-00000000001b'  -- Recibos de Subscrição
 );

UPDATE category
   SET parent_id = '01960000-0002-7000-8000-000000000021'
 WHERE id IN (
   '01960000-0002-7000-8000-000000000003', -- BDR
   '01960000-0002-7000-8000-00000000000f'  -- Exterior
 );

UPDATE category
   SET parent_id = '01960000-0002-7000-8000-000000000022'
 WHERE id IN (
   '01960000-0002-7000-8000-000000000005', -- CDB
   '01960000-0002-7000-8000-000000000006', -- CDCA
   '01960000-0002-7000-8000-000000000009', -- CRI / CRA
   '01960000-0002-7000-8000-00000000000b', -- Debêntures
   '01960000-0002-7000-8000-00000000000d', -- DPGE
   '01960000-0002-7000-8000-000000000013', -- LC
   '01960000-0002-7000-8000-000000000014', -- LCA / LCI / LCD
   '01960000-0002-7000-8000-000000000015', -- LF / LFS / LFSN
   '01960000-0002-7000-8000-000000000016', -- LIG
   '01960000-0002-7000-8000-000000000019', -- Operação Compromissada
   '01960000-0002-7000-8000-00000000001a', -- Poupança
   '01960000-0002-7000-8000-00000000001c', -- RDB / RDC
   '01960000-0002-7000-8000-00000000001e'  -- Tesouro Direto
 );

UPDATE category
   SET parent_id = '01960000-0002-7000-8000-000000000023'
 WHERE id IN (
   '01960000-0002-7000-8000-000000000007', -- COE
   '01960000-0002-7000-8000-000000000008', -- Commodities
   '01960000-0002-7000-8000-00000000000a', -- Criptomoedas
   '01960000-0002-7000-8000-000000000012', -- Futuros
   '01960000-0002-7000-8000-000000000017'  -- Moedas
 );

UPDATE category
   SET parent_id = '01960000-0002-7000-8000-000000000024'
 WHERE id = '01960000-0002-7000-8000-000000000010'; -- FIIs
