-- Vencimento na caixinha. Duas formas de vencer: a caixinha inteira vence
-- (`asset.maturity_date`, e todo lote herda), ou a caixinha não vence e cada lote
-- tem o seu — informado no aporte (`transaction.maturity_date`) ou derivado do
-- prazo padrão (`asset.lot_term_months`).
ALTER TABLE asset
  ADD COLUMN lot_term_months SMALLINT,
  ADD CONSTRAINT asset_lot_term_positive
    CHECK (lot_term_months IS NULL OR lot_term_months > 0),
  ADD CONSTRAINT asset_lot_term_needs_lots
    CHECK (lot_term_months IS NULL
           OR (redemption_rule IS NOT NULL AND maturity_date IS NULL));

ALTER TABLE transaction
  ADD COLUMN maturity_date DATE,
  ADD CONSTRAINT transaction_maturity_not_before_trade
    CHECK (maturity_date IS NULL OR maturity_date >= trade_date);
