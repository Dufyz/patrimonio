-- Estorno ligado à compra que ele desfaz: o item de crédito guarda o id do
-- lançamento ou do item estornado, e a tela marca a linha original como estornada.
ALTER TABLE fin_card_item ADD COLUMN reverses_id UUID;
CREATE INDEX fin_card_item_reverses_idx ON fin_card_item (reverses_id) WHERE reverses_id IS NOT NULL;
