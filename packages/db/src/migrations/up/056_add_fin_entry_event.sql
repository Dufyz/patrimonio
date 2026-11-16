-- LIV-03 · vínculo do lançamento com o evento do livro unificado.
ALTER TABLE fin_entry ADD COLUMN event_id UUID;
CREATE INDEX fin_entry_event_idx ON fin_entry (event_id) WHERE event_id IS NOT NULL;
