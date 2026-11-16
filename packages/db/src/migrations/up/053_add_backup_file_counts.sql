-- BKP-03 · o que o backup contém, para a tela mostrar antes de restaurar sem
-- precisar decifrar o arquivo: lançamentos (livro de Finanças e de
-- Investimentos) e carteiras no momento do dump. Nulos nos backups antigos.
ALTER TABLE backup_file
  ADD COLUMN entries    INTEGER CHECK (entries IS NULL OR entries >= 0),
  ADD COLUMN portfolios INTEGER CHECK (portfolios IS NULL OR portfolios >= 0);
