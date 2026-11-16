-- LIV-03 · o aporte liga as duas pernas (transação e movimento) por event_id e guarda a conta.
ALTER TABLE transaction
  ADD COLUMN event_id   UUID,
  ADD COLUMN account_id UUID;
CREATE INDEX transaction_event_idx ON transaction (event_id) WHERE event_id IS NOT NULL;
