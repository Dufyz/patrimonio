-- Só os identificadores que o seed escreveu: um benchmark que o usuário criou
-- com o mesmo nome, e que o `ON CONFLICT` preservou, não é nosso para apagar.
DELETE FROM benchmark
 WHERE id IN (
   '019b0000-0000-7000-8000-000000000001',
   '019b0000-0000-7000-8000-000000000002',
   '019b0000-0000-7000-8000-000000000003',
   '019b0000-0000-7000-8000-000000000004',
   '019b0000-0000-7000-8000-000000000005'
 );
