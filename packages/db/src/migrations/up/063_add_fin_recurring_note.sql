-- Anotações livres no recorrente, além do nome do item.
ALTER TABLE fin_recurring ADD COLUMN note TEXT;
ALTER TABLE fin_recurring ADD CONSTRAINT fin_recurring_note_length
  CHECK (note IS NULL OR char_length(note) <= 200);
