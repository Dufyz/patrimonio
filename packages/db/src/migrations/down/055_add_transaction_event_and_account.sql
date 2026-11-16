DROP INDEX IF EXISTS transaction_event_idx;
ALTER TABLE transaction
  DROP COLUMN account_id,
  DROP COLUMN event_id;
