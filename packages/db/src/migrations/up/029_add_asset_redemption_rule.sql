-- Caixinha: um ativo cujos aportes são lotes. A regra diz qual lote o resgate
-- consome primeiro; nulo é o título comum, de preço médio único. Os lotes não são
-- gravados, saem do livro, então a regra é o único dado novo.
CREATE TYPE redemption_rule AS ENUM ('oldest_first', 'newest_first');

ALTER TABLE asset
  ADD COLUMN redemption_rule redemption_rule,
  ADD CONSTRAINT asset_lots_are_manual_fixed_income
    CHECK (redemption_rule IS NULL OR (origin = 'manual' AND indexer IS NOT NULL));
