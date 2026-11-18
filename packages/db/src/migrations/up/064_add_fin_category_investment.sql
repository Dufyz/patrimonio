-- Categoria de investimento: a despesa que é aporte (sai da conta para as carteiras).
ALTER TABLE fin_category
  ADD COLUMN investment BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT fin_category_investment_valid
    CHECK (investment = FALSE OR kind = 'DESPESA');
