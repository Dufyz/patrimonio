-- Categoria de despesa: fixa ou livre.
ALTER TABLE fin_category
  ADD COLUMN nature TEXT,
  ADD CONSTRAINT fin_category_nature_valid
    CHECK (nature IS NULL OR (kind = 'DESPESA' AND nature IN ('FIXA', 'LIVRE')));
