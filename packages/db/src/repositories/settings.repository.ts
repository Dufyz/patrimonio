import type {
  SettingsArchivedPortfolioRow,
  SettingsBackupRow,
  SettingsPortfolioRow,
  SettingsRepository,
} from '@patrimonio/application';
import {
  asBoolean,
  asDateOnly,
  asInteger,
  asIsoStringOrNull,
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
 * Uma decisão dentro dela que não é óbvia:
 *
 * - **Carteira arquivada não conta como carteira do objetivo.** Ela está fora da barra lateral e fora das somas; listá-la ao
 *   lado de "Longo prazo" como se estivesse viva faria a tela mentir sobre o
 *   que está em uso. Ela aparece à parte, em `archived_portfolios`.
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
  benchmark: asStringOrNull(row, 'benchmark'),
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
          SELECT p.id, p.name, p.benchmark, p.sort_order
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
                     'benchmark', p.benchmark,
                     'strategy_categories', (
                       SELECT COUNT(*) FROM strategy_target s WHERE s.portfolio_id = p.id
                     ),
                     'goals', COALESCE((
                       SELECT JSONB_AGG(g.name ORDER BY g.target_date, g.name)
                         FROM goal g
                        WHERE g.portfolio_id = p.id AND g.closed_at IS NULL
                     ), '[]'::JSONB),
                     'transactions', COALESCE(c.transactions, 0),
                     'assets', COALESCE(c.assets, 0)
                   ) ORDER BY p.sort_order, LOWER(p.name)
                 ), '[]'::JSONB) AS value
            FROM open_portfolio p
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

  exportAll: async () => {
    try {
      // Um documento só, em texto. Cada tabela é um array de objetos com os
      // nomes de coluna do banco, que é o formato que outra ferramenta lê.
      const [row] = await sql<{ document: string }[]>`
        SELECT JSON_BUILD_OBJECT(
          'exported_at', NOW(),
          'format', 'patrimonio-export-v1',
          'tables', JSON_BUILD_OBJECT(
            'institution', (SELECT COALESCE(JSON_AGG(t ORDER BY t.created_at), '[]'::JSON) FROM institution t),
            'category', (SELECT COALESCE(JSON_AGG(t), '[]'::JSON) FROM category t),
            'portfolio', (SELECT COALESCE(JSON_AGG(t ORDER BY t.created_at), '[]'::JSON) FROM portfolio t),
            'asset', (SELECT COALESCE(JSON_AGG(t ORDER BY t.ticker), '[]'::JSON) FROM asset t),
            'transaction', (SELECT COALESCE(JSON_AGG(t ORDER BY t.trade_date, t.created_at), '[]'::JSON) FROM transaction t),
            'strategy_target', (SELECT COALESCE(JSON_AGG(t), '[]'::JSON) FROM strategy_target t),
            'goal', (SELECT COALESCE(JSON_AGG(t), '[]'::JSON) FROM goal t),
            'manual_price', (SELECT COALESCE(JSON_AGG(t ORDER BY t.price_date), '[]'::JSON) FROM manual_price t),
            'announced_payout', (SELECT COALESCE(JSON_AGG(t), '[]'::JSON) FROM announced_payout t),
            'corporate_event', (SELECT COALESCE(JSON_AGG(t ORDER BY t.record_date), '[]'::JSON) FROM corporate_event t),
            'payout_dismissal', (SELECT COALESCE(JSON_AGG(t), '[]'::JSON) FROM payout_dismissal t),
            'custody_transfer', (SELECT COALESCE(JSON_AGG(t ORDER BY t.transfer_date, t.created_at), '[]'::JSON) FROM custody_transfer t)
          )
        )::TEXT AS document
      `;

      return success(row?.document ?? '{}');
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  deleteAll: async () => {
    try {
      // Na ordem das chaves, uma instrução por passo: RESTRICT é conferido na
      // hora, e apagar lançamento e carteira na mesma instrução o tropeçaria.
      // A carteira leva junto, por cascata, estratégia, objetivos, posições,
      // patrimônio diário, resultado realizado, descartes e desfazer.
      const transactions = await sql`DELETE FROM transaction RETURNING 1`;
      await sql`DELETE FROM announced_payout`;
      await sql`DELETE FROM manual_price`;
      const portfolios = await sql`DELETE FROM portfolio RETURNING 1`;
      await sql`DELETE FROM tax_month`;
      await sql`
        DELETE FROM pipeline_outbox
         WHERE stage = 'recalc' AND dispatched_at IS NULL AND failed_at IS NULL
      `;
      // Mercado fica (origin = 'market'), com os preços dele: não é da pessoa e
      // recarregar o COTAHIST custa horas.
      await sql`UPDATE asset SET issuer_id = NULL WHERE issuer_id IS NOT NULL`;
      const assets = await sql`DELETE FROM asset WHERE origin = 'manual' RETURNING 1`;
      const institutions = await sql`DELETE FROM institution RETURNING 1`;

      return success({
        transactions: transactions.length,
        portfolios: portfolios.length,
        assets: assets.length,
        institutions: institutions.length,
      });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
