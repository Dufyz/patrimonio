-- Uma carteira tem no máximo um objetivo aberto. Quem já tinha mais de um fica
-- com o criado por último; os outros são encerrados, e o histórico se mantém.
UPDATE goal g
   SET closed_at = NOW()
 WHERE g.closed_at IS NULL
   AND EXISTS (
     SELECT 1 FROM goal newer
      WHERE newer.portfolio_id = g.portfolio_id
        AND newer.closed_at IS NULL
        AND (newer.created_at, newer.id) > (g.created_at, g.id)
   );

-- O nome deixa de ser o que distingue objetivos abertos: a vaga da carteira é.
DROP INDEX IF EXISTS goal_name_open_idx;

CREATE UNIQUE INDEX goal_portfolio_open_idx ON goal (portfolio_id) WHERE closed_at IS NULL;
