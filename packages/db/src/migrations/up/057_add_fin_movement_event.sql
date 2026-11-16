-- LIV-03 · vínculo do movimento com o evento do livro unificado.
ALTER TABLE fin_movement ADD COLUMN event_id UUID;
CREATE INDEX fin_movement_event_idx ON fin_movement (event_id) WHERE event_id IS NOT NULL;
