-- O tipo do papel na B3 não é derivável do ticker — TAEE11 é unit e KNRI11 é
-- FII, e os dois terminam em 11 —, e é ele que a regra automática de categoria
-- olha e que sugere a classe no cadastro. Por isso ele é guardado, e não
-- inferido na tela.
alter table asset add column b3_type text;

alter table asset add constraint asset_b3_type_known
  check (b3_type is null or b3_type in ('stock', 'fii', 'etf', 'bdr', 'treasury', 'cash'));

-- Parcial: título bancário não tem tipo de B3, e o índice não precisa carregar
-- essas linhas.
create index asset_b3_type_idx on asset (b3_type) where b3_type is not null;
