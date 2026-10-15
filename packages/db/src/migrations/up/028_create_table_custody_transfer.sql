-- A troca de custodiante de um ativo: o papel sai de uma instituição e vai para
-- outra, sem vender e sem comprar. Quantidade, preço médio, caixa e resultado
-- não mudam, e é por isso que a troca não é um `transaction`: o motor de
-- cálculo lê todo lançamento e assume que ele mexe em quantidade ou dinheiro.
--
-- Tabela de fonte: o usuário a escreve e o backup precisa dela. A custódia
-- atual de um ativo é a instituição do evento mais recente entre o último
-- lançamento e a última transferência.
CREATE TABLE custody_transfer (
  id                  UUID PRIMARY KEY,
  portfolio_id        UUID NOT NULL REFERENCES portfolio (id) ON DELETE CASCADE,
  asset_id            UUID NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
  from_institution_id UUID NOT NULL REFERENCES institution (id) ON DELETE RESTRICT,
  to_institution_id   UUID NOT NULL REFERENCES institution (id) ON DELETE RESTRICT,
  transfer_date       DATE NOT NULL,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT custody_transfer_changes_institution
    CHECK (from_institution_id <> to_institution_id)
);

CREATE INDEX custody_transfer_portfolio_asset_idx
  ON custody_transfer (portfolio_id, asset_id, transfer_date DESC, created_at DESC);

CREATE TRIGGER custody_transfer_set_updated_at
  BEFORE UPDATE ON custody_transfer
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
