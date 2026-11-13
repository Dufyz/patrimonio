ALTER TABLE asset DROP CONSTRAINT IF EXISTS asset_etf_exposure_only_etf;
ALTER TABLE asset DROP CONSTRAINT IF EXISTS asset_etf_exposure_known;
ALTER TABLE asset DROP COLUMN IF EXISTS etf_exposure;
