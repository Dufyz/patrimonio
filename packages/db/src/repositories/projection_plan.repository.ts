import type {
  ProjectionPlanRepository,
  ProjectionPlanRow,
} from '@patrimonio/application';
import {
  asDateOnlyOrNull,
  asNumeric,
  asNumericOrNull,
  asString,
  asStringOrNull,
} from '@patrimonio/domain';
import type { Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * PRJ-06 · O plano da Projeção. A leitura é **uma** consulta: carteiras
 * ativas, o último fechamento de cada uma até hoje e as regras agregadas em
 * JSON. A escrita troca a rentabilidade e todas as regras da carteira, e roda
 * dentro da transação da unidade de trabalho.
 */
const asRules = (value: unknown): ProjectionPlanRow['rules'] =>
  (Array.isArray(value) ? (value as Row[]) : []).map((rule) => ({
    amount: asNumeric(rule, 'amount'),
    from: asString(rule, 'from'),
    until: asStringOrNull(rule, 'until'),
  }));

export const createProjectionPlanRepository = (
  sql: Connection,
): ProjectionPlanRepository => ({
  list: async (today) => {
    try {
      const rows = await sql<Row[]>`
        SELECT p.id::TEXT AS portfolio_id,
               p.name,
               p.expected_return_pct::TEXT AS expected_return_pct,
               last.total_value::TEXT AS current_value,
               last.position_date::TEXT AS as_of,
               COALESCE((
                 SELECT JSON_AGG(JSON_BUILD_OBJECT(
                          'amount', r.amount::TEXT,
                          'from', r.from_month,
                          'until', r.until_month
                        ) ORDER BY r.from_month, r.created_at)
                   FROM projection_rule r
                  WHERE r.portfolio_id = p.id
               ), '[]'::JSON) AS rules
          FROM portfolio p
          LEFT JOIN LATERAL (
            SELECT pd.total_value, pd.position_date
              FROM portfolio_daily pd
             WHERE pd.portfolio_id = p.id
               AND pd.position_date <= ${today}::DATE
             ORDER BY pd.position_date DESC
             LIMIT 1
          ) last ON TRUE
         WHERE p.archived_at IS NULL
         ORDER BY p.sort_order, LOWER(p.name)
      `;

      return success(
        rows.map((row): ProjectionPlanRow => ({
          portfolio_id: asString(row, 'portfolio_id'),
          name: asString(row, 'name'),
          expected_return_pct: asNumericOrNull(row, 'expected_return_pct'),
          current_value: asNumericOrNull(row, 'current_value'),
          as_of: asDateOnlyOrNull(row, 'as_of'),
          rules: asRules(row['rules']),
        })),
      );
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  save: async (portfolioId, write) => {
    try {
      await sql`
        UPDATE portfolio
           SET expected_return_pct = ${write.expected_return_pct}::NUMERIC(5,2)
         WHERE id = ${portfolioId}::UUID
      `;
      await sql`DELETE FROM projection_rule WHERE portfolio_id = ${portfolioId}::UUID`;

      if (write.rules.length > 0) {
        await sql`
          INSERT INTO projection_rule (id, portfolio_id, amount, from_month, until_month)
          SELECT rule.id::UUID, ${portfolioId}::UUID, rule.amount::NUMERIC(20,2),
                 rule.from_month, rule.until_month
            FROM UNNEST(
                   ${sql.array(write.rules.map(() => uuidv7()))}::TEXT[],
                   ${sql.array(write.rules.map((rule) => rule.amount))}::TEXT[],
                   ${sql.array(write.rules.map((rule) => rule.from))}::TEXT[],
                   ${sql.array(write.rules.map((rule) => rule.until))}::TEXT[]
                 ) AS rule(id, amount, from_month, until_month)
        `;
      }

      return success(undefined);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
