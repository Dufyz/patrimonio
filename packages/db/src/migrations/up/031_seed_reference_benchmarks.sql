INSERT INTO benchmark (id, name, kind, definition, rebalance)
VALUES
  ('019b0000-0000-7000-8000-000000000001', 'CDI', 'index', '{"index": "CDI"}'::JSONB, 'never'),
  ('019b0000-0000-7000-8000-000000000002', 'Selic', 'index', '{"index": "SELIC"}'::JSONB, 'never'),
  ('019b0000-0000-7000-8000-000000000003', 'IPCA', 'index', '{"index": "IPCA"}'::JSONB, 'never'),
  ('019b0000-0000-7000-8000-000000000004', 'Ibovespa', 'index', '{"index": "IBOV"}'::JSONB, 'never'),
  ('019b0000-0000-7000-8000-000000000005', 'IFIX', 'index', '{"index": "IFIX"}'::JSONB, 'never')
ON CONFLICT ((LOWER(name))) DO NOTHING;
