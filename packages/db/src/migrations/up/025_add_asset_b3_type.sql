ALTER TABLE asset ADD COLUMN b3_type TEXT;

ALTER TABLE asset ADD CONSTRAINT asset_b3_type_known
  CHECK (b3_type IS NULL OR b3_type IN ('stock', 'fii', 'etf', 'bdr', 'treasury', 'cash'));

CREATE INDEX asset_b3_type_idx ON asset (b3_type) WHERE b3_type IS NOT NULL;
