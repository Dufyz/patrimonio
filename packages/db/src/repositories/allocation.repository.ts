import type {
  AllocationCategoryRow,
  AllocationPortfolioRow,
  AllocationQuery,
  AllocationRepository,
  AllocationSnapshot,
  AllocationTargetRow,
} from '@patrimonio/application';
import {
  asDateOnlyOrNull,
  asEnum,
  asInteger,
  asIntegerOrNull,
  asNumeric,
  asNumericOrNull,
  asString,
  asStringOrNull,
  RECALC_STATUSES,
} from '@patrimonio/domain';
import type { Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * A tela de Estratégia em **uma** consulta: a carteira com as regras, o cadastro
 * de categorias com o valor de cada uma, e o alvo declarado — todos sobre o mesmo
 * fechamento.
 *
 * Três decisões dentro dela que não são óbvias:
 *
 * - **O cadastro inteiro entra, com ou sem posição.** Declarar alvo para uma
 *   categoria vazia é exatamente o que a primeira estratégia faz; ler só o que
 *   está em carteira a deixaria sem as linhas que ela precisa preencher.
 * - **Ativo direto num grupo vira a linha "Outros" do grupo.** O banco permite
 *   classificar um ativo num grupo, não só numa categoria; sem a linha, o grupo
 *   deixaria de ser a soma das categorias dentro dele, e o subtotal da tela
 *   divergiria do valor do grupo. O id da linha é o do próprio grupo, que é uma
 *   categoria como outra qualquer para o alvo.
 * - **Ativo sem categoria aparece como "Sem categoria"**, sem alvo possível:
 *   ele é patrimônio, e escondê-lo inflaria o peso de todo o resto.
 */
const SEM_CATEGORIA = 'sem-categoria';

/** Depois de qualquer categoria do cadastro: ordem de exibição, não de valor. */
const AFTER_CATALOG = 1_000_000;

const parsePortfolio = (row: Row): AllocationPortfolioRow => ({
  portfolio_id: asString(row, 'portfolio_id'),
  name: asString(row, 'name'),
  recalc_status: asEnum(row, 'recalc_status', RECALC_STATUSES),
  benchmark_id: asStringOrNull(row, 'benchmark_id'),
  benchmark_name: asStringOrNull(row, 'benchmark_name'),
  reviewed_on: asDateOnlyOrNull(row, 'reviewed_on'),
  total_value: asNumericOrNull(row, 'total_value'),
});

const parseCategory = (row: Row): AllocationCategoryRow => ({
  category_id: asString(row, 'category_id'),
  category_name: asString(row, 'category_name'),
  group_id: asStringOrNull(row, 'group_id'),
  group_name: asStringOrNull(row, 'group_name'),
  group_sort_order: asIntegerOrNull(row, 'group_sort_order'),
  color_token: asString(row, 'color_token'),
  sort_order: asInteger(row, 'sort_order'),
  value: asNumeric(row, 'value'),
});

const parseTarget = (row: Row): AllocationTargetRow => ({
  category_id: asString(row, 'category_id'),
  target_pct: asNumeric(row, 'target_pct'),
});

const asRows = (value: unknown): readonly Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export const createAllocationRepository = (sql: Connection): AllocationRepository => ({
  snapshot: async (query: AllocationQuery) => {
    try {
      const [row] = await sql<Row[]>`
        WITH reference AS (
          SELECT MAX(position_date) AS position_date
            FROM portfolio_daily
           WHERE portfolio_id = ${query.portfolio_id}::UUID
             AND position_date <= ${query.on_date}::DATE
        ),
        portfolio_row AS (
          SELECT p.id::TEXT AS portfolio_id,
                 p.name,
                 p.recalc_status,
                 p.benchmark_id::TEXT AS benchmark_id,
                 benchmark.name AS benchmark_name,
                 (SELECT MAX(target.updated_at)::DATE
                    FROM strategy_target target
                   WHERE target.portfolio_id = p.id) AS reviewed_on,
                 (SELECT day.total_value::TEXT
                    FROM portfolio_daily day
                   WHERE day.portfolio_id = p.id
                     AND day.position_date <= ${query.on_date}::DATE
                   ORDER BY day.position_date DESC
                   LIMIT 1) AS total_value
            FROM portfolio p
            LEFT JOIN benchmark ON benchmark.id = p.benchmark_id
           WHERE p.id = ${query.portfolio_id}::UUID
             AND p.archived_at IS NULL
        ),
        -- A carteira na última data que ela tem até a referência: recálculo
        -- atrasado não pode esvaziar a tela.
        last_position AS (
          SELECT MAX(position_date) AS position_date
            FROM position_daily
           WHERE portfolio_id = ${query.portfolio_id}::UUID
             AND position_date <= (SELECT position_date FROM reference)
        ),
        held AS (
          SELECT pos.asset_id, pos.market_value
            FROM position_daily pos
           WHERE pos.portfolio_id = ${query.portfolio_id}::UUID
             AND pos.position_date = (SELECT position_date FROM last_position)
             AND pos.quantity <> 0
        ),
        category_values AS (
          SELECT asset.category_id, SUM(held.market_value) AS value
            FROM held
            JOIN asset ON asset.id = held.asset_id
           GROUP BY asset.category_id
        ),
        catalog AS (
          SELECT c.id,
                 c.name,
                 c.parent_id,
                 c.color_token,
                 c.sort_order,
                 EXISTS (
                   SELECT 1 FROM category child WHERE child.parent_id = c.id
                 ) AS is_group
            FROM category c
        ),
        lines AS (
          SELECT c.id::TEXT AS category_id,
                 c.name AS category_name,
                 parent.id::TEXT AS group_id,
                 parent.name AS group_name,
                 parent.sort_order AS group_sort_order,
                 c.color_token,
                 c.sort_order,
                 COALESCE(v.value, 0)::TEXT AS value
            FROM catalog c
            LEFT JOIN catalog parent ON parent.id = c.parent_id
            LEFT JOIN category_values v ON v.category_id = c.id
           WHERE NOT c.is_group

          UNION ALL

          SELECT c.id::TEXT,
                 'Outros',
                 c.id::TEXT,
                 c.name,
                 c.sort_order,
                 c.color_token,
                 ${AFTER_CATALOG}::INT,
                 v.value::TEXT
            FROM catalog c
            JOIN category_values v ON v.category_id = c.id
           WHERE c.is_group AND v.value <> 0

          UNION ALL

          SELECT ${SEM_CATEGORIA},
                 'Sem categoria',
                 NULL,
                 NULL,
                 NULL,
                 'class.outros',
                 ${AFTER_CATALOG}::INT,
                 v.value::TEXT
            FROM category_values v
           WHERE v.category_id IS NULL AND v.value <> 0
        )
        SELECT (SELECT position_date FROM reference) AS reference_date,
               (SELECT TO_JSONB(portfolio_row) FROM portfolio_row) AS portfolio,
               COALESCE((
                 SELECT JSONB_AGG(
                          TO_JSONB(lines)
                          ORDER BY lines.group_sort_order NULLS LAST,
                                   lines.sort_order,
                                   lines.category_name
                        )
                   FROM lines
               ), '[]'::JSONB) AS categories,
               COALESCE((
                 SELECT JSONB_AGG(
                          JSONB_BUILD_OBJECT(
                            'category_id', target.category_id::TEXT,
                            'target_pct', target.target_pct::TEXT
                          )
                        )
                   FROM strategy_target target
                  WHERE target.portfolio_id = ${query.portfolio_id}::UUID
               ), '[]'::JSONB) AS targets
      `;

      if (row === undefined) {
        return failure(
          getRepositoryError(new Error('a consulta da estratégia não devolveu linha')),
        );
      }

      const portfolio = row['portfolio'];

      const snapshot: AllocationSnapshot = {
        reference_date: asDateOnlyOrNull(row, 'reference_date'),
        portfolio:
          portfolio === null || portfolio === undefined
            ? null
            : parsePortfolio(portfolio as Row),
        categories: asRows(row['categories']).map(parseCategory),
        targets: asRows(row['targets']).map(parseTarget),
      };

      return success(snapshot);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
