-- A busca global compara sem acento: quem digita "itau" procura "Itaú
-- Unibanco", e quem digita "acoes" procura "Ações". O `ilike` do Postgres não
-- ignora acento, e a paleta já pontua sem ele — sem esta extensão, o banco e a
-- tela discordariam sobre o que casa.
--
-- `unaccent` é uma extensão de contribuição que a imagem oficial do Postgres já
-- traz, e é "trusted": o dono do banco a cria, sem precisar de superusuário.
create extension if not exists unaccent;
