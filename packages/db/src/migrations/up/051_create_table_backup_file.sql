-- BKP-01 · o que o bucket guarda, visto pela tela. O arquivo cifrado mora no
-- Storage; aqui ficam só o nome, o dia, o tamanho e a versão do esquema, que é o
-- que a tabela de backups mostra sem precisar falar com o Storage.
CREATE TABLE backup_file (
  name           TEXT PRIMARY KEY,
  taken_on       DATE NOT NULL,
  manual         BOOLEAN NOT NULL DEFAULT FALSE,
  bytes          BIGINT NOT NULL CHECK (bytes >= 0),
  schema_version TEXT,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX backup_file_taken_idx ON backup_file (taken_on DESC, created_at DESC);
