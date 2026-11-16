-- Livro unificado: colunas e regras que as migrations 006, 008, 036, 037, 039, 041,
-- 043 e 048 passaram a precisar. Migration aplicada nunca é editada: tudo aqui é ALTER.

-- PRJ-06 / EST-03 · carteira: tolerância da Estratégia e rentabilidade esperada da projeção.
ALTER TABLE portfolio
  ADD COLUMN strategy_tolerance_pp NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
  ADD COLUMN expected_return_pct   NUMERIC(5, 2),
  ADD CONSTRAINT portfolio_expected_return_range
    CHECK (expected_return_pct IS NULL OR (expected_return_pct >= 0 AND expected_return_pct <= 100)),
  ADD CONSTRAINT portfolio_strategy_tolerance_range
    CHECK (strategy_tolerance_pp > 0 AND strategy_tolerance_pp <= 100);

-- LIV-03 · o aporte liga as duas pernas (transação e movimento) por event_id.
ALTER TABLE transaction
  ADD COLUMN event_id   UUID,
  ADD COLUMN account_id UUID;
CREATE INDEX transaction_event_idx ON transaction (event_id) WHERE event_id IS NOT NULL;

ALTER TABLE fin_entry ADD COLUMN event_id UUID;
CREATE INDEX fin_entry_event_idx ON fin_entry (event_id) WHERE event_id IS NOT NULL;

ALTER TABLE fin_movement ADD COLUMN event_id UUID;
CREATE INDEX fin_movement_event_idx ON fin_movement (event_id) WHERE event_id IS NOT NULL;

ALTER TABLE fin_movement DROP CONSTRAINT fin_movement_kind_valid;
ALTER TABLE fin_movement ADD CONSTRAINT fin_movement_kind_valid
  CHECK (kind IN ('TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA', 'AJUSTE', 'APORTE', 'RESGATE', 'PROVENTO'));

-- Categoria de despesa: fixa ou livre.
ALTER TABLE fin_category
  ADD COLUMN nature TEXT,
  ADD CONSTRAINT fin_category_nature_valid
    CHECK (nature IS NULL OR (kind = 'DESPESA' AND nature IN ('FIXA', 'LIVRE')));

-- RN-U2 · a marca "no patrimônio" da conta.
ALTER TABLE fin_account ADD COLUMN in_wealth BOOLEAN NOT NULL DEFAULT TRUE;

-- LIV-11 · recorrente de aporte: sem categoria, com carteira e ativo.
ALTER TABLE fin_recurring
  ALTER COLUMN category_id DROP NOT NULL,
  ADD COLUMN portfolio_id UUID REFERENCES portfolio (id) ON DELETE CASCADE,
  ADD COLUMN asset_id     UUID REFERENCES asset (id) ON DELETE SET NULL;
ALTER TABLE fin_recurring DROP CONSTRAINT fin_recurring_kind_valid;
ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_kind_valid
  CHECK (kind IN ('RECEITA', 'DESPESA', 'APORTE'));
ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_aporte_coherent CHECK (
  (kind = 'APORTE' AND category_id IS NULL AND portfolio_id IS NOT NULL
    AND source_type = 'CONTA' AND mode = 'MANUAL' AND NOT split)
  OR (kind <> 'APORTE' AND category_id IS NOT NULL AND portfolio_id IS NULL AND asset_id IS NULL)
);
