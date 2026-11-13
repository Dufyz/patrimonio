-- EST-02: o que o ETF expõe define a classe dele. Nulo é "ainda não definido"
-- e cai em Outros, onde se vê.
ALTER TABLE asset ADD COLUMN etf_exposure TEXT;

ALTER TABLE asset ADD CONSTRAINT asset_etf_exposure_known
  CHECK (etf_exposure IS NULL
         OR etf_exposure IN ('acoes_brasil', 'acoes_exterior', 'renda_fixa', 'fiis'));

ALTER TABLE asset ADD CONSTRAINT asset_etf_exposure_only_etf
  CHECK (etf_exposure IS NULL OR b3_type = 'etf');
