ALTER TABLE fin_recurring DROP CONSTRAINT IF EXISTS fin_recurring_note_length;
ALTER TABLE fin_recurring DROP COLUMN IF EXISTS note;
