-- O Postgres não remove valor de enum. Remover o estágio exige recriar o tipo, e
-- só vale a pena quando nenhuma linha da outbox o usa; em desenvolvimento,
-- refaça o banco.
DELETE FROM pipeline_outbox WHERE stage = 'finance';
