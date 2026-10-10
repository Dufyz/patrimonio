import type {
  SettingsAlertRuleRow,
  SettingsArchivedPortfolioRow,
  SettingsBackupRow,
  SettingsBenchmarkRow,
  SettingsCategoryRow,
  SettingsInstitutionRow,
  SettingsPortfolioRow,
  SettingsRepository,
} from '@patrimonio/application';
import {
  asBoolean,
  asDateOnly,
  asEnum,
  asInteger,
  asIsoStringOrNull,
  asJsonOrNull,
  asNumeric,
  asNumericOrNull,
  asString,
  asStringOrNull,
} from '@patrimonio/domain';
import type { Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * A tela de Configurações em **uma** consulta: cada cadastro volta como um array
 * `jsonb` já agregado, com as contagens que explicam um bloqueio de exclusão.
 *
 * Três decisões dentro dela que não são óbvias:
 *
 * - **Carteira arquivada não conta como carteira da instituição nem do
 *   objetivo.** Ela está fora da barra lateral e fora das somas; listá-la ao
 *   lado de "Longo prazo" como se estivesse viva faria a tela mentir sobre o
 *   que está em uso. Ela aparece à parte, em `archived_portfolios`.
 * - **O caixa de uma instituição é o último valor de cada carteira nos ativos
 *   de caixa dela.** O caixa é um ativo sintético com `issuer_id` na própria
 *   instituição (L-07), e o valor dele é o saldo — então a soma do último
 *   `position_daily` por carteira é o que está parado ali, e ela não depende de
 *   uma coluna de saldo que não existe.
 * - **A exposição do emissor sai do livro, e exclui o caixa.** É a mesma conta
 *   de `issuerExposure` (aplicado menos resgatado nos títulos manuais), feita
 *   para todas as instituições de uma vez; o caixa fica de fora porque saldo
 *   em conta não é título emitido, e o FGC mede o que se aplicou nele.
 */
const asRows = (value: unknown): readonly Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const asStrings = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const parsePortfolio = (row: Row): SettingsPortfolioRow => ({
  id: asString(row, 'id'),
  name: asString(row, 'name'),
  benchmark_id: asStringOrNull(row, 'benchmark_id'),
  benchmark_name: asStringOrNull(row, 'benchmark_name'),
  strategy_categories: asInteger(row, 'strategy_categories'),
  goals: asStrings(row['goals']),
  transactions: asInteger(row, 'transactions'),
  assets: asInteger(row, 'assets'),
});

const parseArchived = (row: Row): SettingsArchivedPortfolioRow => ({
  id: asString(row, 'id'),
  name: asString(row, 'name'),
  archived_on: asDateOnly(row, 'archived_on'),
});

const parseCategory = (row: Row): SettingsCategoryRow => ({
  id: asString(row, 'id'),
  parent_id: asStringOrNull(row, 'parent_id'),
  name: asString(row, 'name'),
  color_token: asString(row, 'color_token'),
  auto_rule: asJsonOrNull(row, 'auto_rule'),
  sort_order: asInteger(row, 'sort_order'),
  assets: asInteger(row, 'assets'),
  strategies: asInteger(row, 'strategies'),
  children: asInteger(row, 'children'),
});

const parseInstitution = (row: Row): SettingsInstitutionRow => ({
  id: asString(row, 'id'),
  name: asString(row, 'name'),
  role: asEnum(row, 'role', ['custodian', 'issuer', 'both']),
  fgc_covered: asBoolean(row, 'fgc_covered'),
  brokerage_per_order: asNumeric(row, 'brokerage_per_order'),
  custody_monthly_fee: asNumeric(row, 'custody_monthly_fee'),
  portfolios: asStrings(row['portfolios']),
  cash: asNumericOrNull(row, 'cash'),
  issuer_exposure: asNumeric(row, 'issuer_exposure'),
  issued_assets: asInteger(row, 'issued_assets'),
  transactions: asInteger(row, 'transactions'),
  assets: asInteger(row, 'assets'),
});

const parseBenchmark = (row: Row): SettingsBenchmarkRow => ({
  id: asString(row, 'id'),
  name: asString(row, 'name'),
  kind: asEnum(row, 'kind', ['index', 'index_plus_rate', 'blend']),
  rebalance: asEnum(row, 'rebalance', ['monthly', 'daily', 'never']),
  definition: asJsonOrNull(row, 'definition') ?? {},
  used_by: asInteger(row, 'used_by'),
});

const parseAlert = (row: Row): SettingsAlertRuleRow => ({
  kind: asString(row, 'kind'),
  enabled: asBoolean(row, 'enabled'),
  scope: asEnum(row, 'scope', ['global', 'per_portfolio']),
  threshold: asJsonOrNull(row, 'threshold'),
});

const parseBackup = (row: Row | undefined): SettingsBackupRow => ({
  last_success_at: row === undefined ? null : asIsoStringOrNull(row, 'last_success_at'),
  last_failure_at: row === undefined ? null : asIsoStringOrNull(row, 'last_failure_at'),
  last_failure_error:
    row === undefined ? null : asStringOrNull(row, 'last_failure_error'),
  pending: row === undefined ? false : asBoolean(row, 'pending'),
});

export const createSettingsRepository = (sql: Connection): SettingsRepository => ({
  snapshot: async () => {
    try {
      const [row] = await sql<Row[]>`
        WITH open_portfolio AS (
          SELECT p.id, p.name, p.benchmark_id, p.sort_order
            FROM portfolio p
           WHERE p.archived_at IS NULL
        ),
        portfolio_content AS (
          SELECT t.portfolio_id,
                 COUNT(*) AS transactions,
                 COUNT(DISTINCT t.asset_id) AS assets
            FROM transaction t
           GROUP BY t.portfolio_id
        ),
        portfolio_json AS (
          SELECT COALESCE(JSONB_AGG(
                   JSONB_BUILD_OBJECT(
                     'id', p.id,
                     'name', p.name,
                     'benchmark_id', p.benchmark_id,
                     'benchmark_name', b.name,
                     'strategy_categories', (
                       SELECT COUNT(*) FROM strategy_target s WHERE s.portfolio_id = p.id
                     ),
                     'goals', COALESCE((
                       SELECT JSONB_AGG(g.name ORDER BY g.target_date, g.name)
                         FROM goal g
                         JOIN goal_portfolio link ON link.goal_id = g.id
                        WHERE link.portfolio_id = p.id AND g.closed_at IS NULL
                     ), '[]'::JSONB),
                     'transactions', COALESCE(c.transactions, 0),
                     'assets', COALESCE(c.assets, 0)
                   ) ORDER BY p.sort_order, LOWER(p.name)
                 ), '[]'::JSONB) AS value
            FROM open_portfolio p
            LEFT JOIN benchmark b ON b.id = p.benchmark_id
            LEFT JOIN portfolio_content c ON c.portfolio_id = p.id
        ),
        archived_json AS (
          SELECT COALESCE(JSONB_AGG(
                   JSONB_BUILD_OBJECT(
                     'id', p.id,
                     'name', p.name,
                     'archived_on', p.archived_at::DATE
                   ) ORDER BY p.archived_at DESC, LOWER(p.name)
                 ), '[]'::JSONB) AS value
            FROM portfolio p
           WHERE p.archived_at IS NOT NULL
        ),
        category_json AS (
          SELECT COALESCE(JSONB_AGG(
                   JSONB_BUILD_OBJECT(
                     'id', c.id,
                     'parent_id', c.parent_id,
                     'name', c.name,
                     'color_token', c.color_token,
                     'auto_rule', c.auto_rule,
                     'sort_order', c.sort_order,
                     -- O grupo soma as categorias dentro dele; as carteiras são as
                     -- distintas, porque duas categorias do mesmo grupo na mesma
                     -- carteira são uma carteira só.
                     'assets', (
                       SELECT COUNT(*) FROM asset a
                        WHERE a.category_id = c.id
                           OR a.category_id IN (
                                SELECT ch.id FROM category ch WHERE ch.parent_id = c.id
                              )
                     ),
                     'strategies', (
                       SELECT COUNT(DISTINCT s.portfolio_id)
                         FROM strategy_target s
                         JOIN open_portfolio op ON op.id = s.portfolio_id
                        WHERE s.category_id = c.id
                           OR s.category_id IN (
                                SELECT ch.id FROM category ch WHERE ch.parent_id = c.id
                              )
                     ),
                     'children', (
                       SELECT COUNT(*) FROM category ch WHERE ch.parent_id = c.id
                     )
                   ) ORDER BY c.sort_order, LOWER(c.name)
                 ), '[]'::JSONB) AS value
            FROM category c
        ),
        -- O último valor de cada carteira nos ativos de caixa da instituição.
        cash_by_institution AS (
          SELECT a.issuer_id AS institution_id, SUM(last_day.market_value) AS cash
            FROM asset a
            CROSS JOIN open_portfolio p
            CROSS JOIN LATERAL (
              SELECT d.market_value
                FROM position_daily d
               WHERE d.portfolio_id = p.id AND d.asset_id = a.id
               ORDER BY d.position_date DESC
               LIMIT 1
            ) last_day
           WHERE a.b3_type = 'cash' AND a.issuer_id IS NOT NULL
           GROUP BY a.issuer_id
        ),
        institution_json AS (
          SELECT COALESCE(JSONB_AGG(
                   JSONB_BUILD_OBJECT(
                     'id', i.id,
                     'name', i.name,
                     'role', i.role,
                     'fgc_covered', i.fgc_covered,
                     'brokerage_per_order', i.brokerage_per_order::TEXT,
                     'custody_monthly_fee', i.custody_monthly_fee::TEXT,
                     'portfolios', COALESCE((
                       SELECT JSONB_AGG(DISTINCT p.name)
                         FROM transaction t
                         JOIN open_portfolio p ON p.id = t.portfolio_id
                        WHERE t.institution_id = i.id
                     ), '[]'::JSONB),
                     'cash', cb.cash::TEXT,
                     'issuer_exposure', COALESCE((
                       SELECT SUM(
                                CASE t.kind
                                  WHEN 'buy'  THEN t.gross_amount
                                  WHEN 'sell' THEN -t.gross_amount
                                  ELSE 0
                                END
                              )
                         FROM asset a
                         JOIN transaction t ON t.asset_id = a.id
                        WHERE a.issuer_id = i.id
                          AND a.origin = 'manual'
                          AND a.b3_type IS DISTINCT FROM 'cash'
                     ), 0)::TEXT,
                     'issued_assets', (
                       SELECT COUNT(DISTINCT a.id)
                         FROM asset a
                         JOIN transaction t ON t.asset_id = a.id
                        WHERE a.issuer_id = i.id
                          AND a.origin = 'manual'
                          AND a.b3_type IS DISTINCT FROM 'cash'
                     ),
                     'transactions', (
                       SELECT COUNT(*) FROM transaction t WHERE t.institution_id = i.id
                     ),
                     'assets', (SELECT COUNT(*) FROM asset a WHERE a.issuer_id = i.id)
                   ) ORDER BY LOWER(i.name)
                 ), '[]'::JSONB) AS value
            FROM institution i
            LEFT JOIN cash_by_institution cb ON cb.institution_id = i.id
        ),
        benchmark_json AS (
          SELECT COALESCE(JSONB_AGG(
                   JSONB_BUILD_OBJECT(
                     'id', b.id,
                     'name', b.name,
                     'kind', b.kind,
                     'rebalance', b.rebalance,
                     'definition', b.definition,
                     'used_by', (
                       SELECT COUNT(*) FROM open_portfolio p WHERE p.benchmark_id = b.id
                     )
                   ) ORDER BY b.created_at, LOWER(b.name)
                 ), '[]'::JSONB) AS value
            FROM benchmark b
        ),
        alert_json AS (
          SELECT COALESCE(JSONB_AGG(
                   JSONB_BUILD_OBJECT(
                     'kind', r.kind,
                     'enabled', r.enabled,
                     'scope', r.scope,
                     'threshold', r.threshold
                   ) ORDER BY r.created_at, r.kind
                 ), '[]'::JSONB) AS value
            FROM alert_rule r
        ),
        backup_row AS (
          SELECT
            (SELECT MAX(o.completed_at)
               FROM pipeline_outbox o
              WHERE o.stage = 'backup' AND o.completed_at IS NOT NULL)
              AS last_success_at,
            -- Só a falha que veio depois do último sucesso: uma falha antiga,
            -- já superada por um backup que deu certo, não é o estado de hoje.
            f.failed_at AS last_failure_at,
            f.error AS last_failure_error,
            EXISTS (
              SELECT 1 FROM pipeline_outbox o
               WHERE o.stage = 'backup'
                 AND o.completed_at IS NULL
                 AND o.failed_at IS NULL
            ) AS pending
            FROM (SELECT 1) one
            LEFT JOIN LATERAL (
              SELECT o.failed_at, o.error
                FROM pipeline_outbox o
               WHERE o.stage = 'backup'
                 AND o.failed_at IS NOT NULL
                 AND o.failed_at > COALESCE((
                       SELECT MAX(ok.completed_at)
                         FROM pipeline_outbox ok
                        WHERE ok.stage = 'backup' AND ok.completed_at IS NOT NULL
                     ), '-infinity'::TIMESTAMPTZ)
               ORDER BY o.failed_at DESC
               LIMIT 1
            ) f ON TRUE
        )
        SELECT (SELECT value FROM portfolio_json) AS portfolios,
               (SELECT value FROM archived_json) AS archived_portfolios,
               (SELECT value FROM category_json) AS categories,
               (SELECT value FROM institution_json) AS institutions,
               (SELECT value FROM benchmark_json) AS benchmarks,
               (SELECT value FROM alert_json) AS alerts,
               (SELECT TO_JSONB(b) FROM backup_row b) AS backup
      `;

      if (row === undefined) {
        return failure(
          getRepositoryError(new Error('a consulta de Configurações não devolveu linha')),
        );
      }

      return success({
        portfolios: asRows(row['portfolios']).map(parsePortfolio),
        archived_portfolios: asRows(row['archived_portfolios']).map(parseArchived),
        categories: asRows(row['categories']).map(parseCategory),
        institutions: asRows(row['institutions']).map(parseInstitution),
        benchmarks: asRows(row['benchmarks']).map(parseBenchmark),
        alerts: asRows(row['alerts']).map(parseAlert),
        backup: parseBackup(
          typeof row['backup'] === 'object' && row['backup'] !== null
            ? (row['backup'] as Row)
            : undefined,
        ),
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
