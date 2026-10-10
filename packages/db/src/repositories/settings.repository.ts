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
        with open_portfolio as (
          select p.id, p.name, p.benchmark_id, p.sort_order
            from portfolio p
           where p.archived_at is null
        ),
        portfolio_content as (
          select t.portfolio_id,
                 count(*) as transactions,
                 count(distinct t.asset_id) as assets
            from transaction t
           group by t.portfolio_id
        ),
        portfolio_json as (
          select coalesce(jsonb_agg(
                   jsonb_build_object(
                     'id', p.id,
                     'name', p.name,
                     'benchmark_id', p.benchmark_id,
                     'benchmark_name', b.name,
                     'strategy_categories', (
                       select count(*) from strategy_target s where s.portfolio_id = p.id
                     ),
                     'goals', coalesce((
                       select jsonb_agg(g.name order by g.target_date, g.name)
                         from goal g
                         join goal_portfolio link on link.goal_id = g.id
                        where link.portfolio_id = p.id and g.closed_at is null
                     ), '[]'::jsonb),
                     'transactions', coalesce(c.transactions, 0),
                     'assets', coalesce(c.assets, 0)
                   ) order by p.sort_order, lower(p.name)
                 ), '[]'::jsonb) as value
            from open_portfolio p
            left join benchmark b on b.id = p.benchmark_id
            left join portfolio_content c on c.portfolio_id = p.id
        ),
        archived_json as (
          select coalesce(jsonb_agg(
                   jsonb_build_object(
                     'id', p.id,
                     'name', p.name,
                     'archived_on', p.archived_at::date
                   ) order by p.archived_at desc, lower(p.name)
                 ), '[]'::jsonb) as value
            from portfolio p
           where p.archived_at is not null
        ),
        category_json as (
          select coalesce(jsonb_agg(
                   jsonb_build_object(
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
                       select count(*) from asset a
                        where a.category_id = c.id
                           or a.category_id in (
                                select ch.id from category ch where ch.parent_id = c.id
                              )
                     ),
                     'strategies', (
                       select count(distinct s.portfolio_id)
                         from strategy_target s
                         join open_portfolio op on op.id = s.portfolio_id
                        where s.category_id = c.id
                           or s.category_id in (
                                select ch.id from category ch where ch.parent_id = c.id
                              )
                     ),
                     'children', (
                       select count(*) from category ch where ch.parent_id = c.id
                     )
                   ) order by c.sort_order, lower(c.name)
                 ), '[]'::jsonb) as value
            from category c
        ),
        -- O último valor de cada carteira nos ativos de caixa da instituição.
        cash_by_institution as (
          select a.issuer_id as institution_id, sum(last_day.market_value) as cash
            from asset a
            cross join open_portfolio p
            cross join lateral (
              select d.market_value
                from position_daily d
               where d.portfolio_id = p.id and d.asset_id = a.id
               order by d.position_date desc
               limit 1
            ) last_day
           where a.b3_type = 'cash' and a.issuer_id is not null
           group by a.issuer_id
        ),
        institution_json as (
          select coalesce(jsonb_agg(
                   jsonb_build_object(
                     'id', i.id,
                     'name', i.name,
                     'role', i.role,
                     'fgc_covered', i.fgc_covered,
                     'brokerage_per_order', i.brokerage_per_order::text,
                     'custody_monthly_fee', i.custody_monthly_fee::text,
                     'portfolios', coalesce((
                       select jsonb_agg(distinct p.name)
                         from transaction t
                         join open_portfolio p on p.id = t.portfolio_id
                        where t.institution_id = i.id
                     ), '[]'::jsonb),
                     'cash', cb.cash::text,
                     'issuer_exposure', coalesce((
                       select sum(
                                case t.kind
                                  when 'buy'  then t.gross_amount
                                  when 'sell' then -t.gross_amount
                                  else 0
                                end
                              )
                         from asset a
                         join transaction t on t.asset_id = a.id
                        where a.issuer_id = i.id
                          and a.origin = 'manual'
                          and a.b3_type is distinct from 'cash'
                     ), 0)::text,
                     'issued_assets', (
                       select count(distinct a.id)
                         from asset a
                         join transaction t on t.asset_id = a.id
                        where a.issuer_id = i.id
                          and a.origin = 'manual'
                          and a.b3_type is distinct from 'cash'
                     ),
                     'transactions', (
                       select count(*) from transaction t where t.institution_id = i.id
                     ),
                     'assets', (select count(*) from asset a where a.issuer_id = i.id)
                   ) order by lower(i.name)
                 ), '[]'::jsonb) as value
            from institution i
            left join cash_by_institution cb on cb.institution_id = i.id
        ),
        benchmark_json as (
          select coalesce(jsonb_agg(
                   jsonb_build_object(
                     'id', b.id,
                     'name', b.name,
                     'kind', b.kind,
                     'rebalance', b.rebalance,
                     'definition', b.definition,
                     'used_by', (
                       select count(*) from open_portfolio p where p.benchmark_id = b.id
                     )
                   ) order by b.created_at, lower(b.name)
                 ), '[]'::jsonb) as value
            from benchmark b
        ),
        alert_json as (
          select coalesce(jsonb_agg(
                   jsonb_build_object(
                     'kind', r.kind,
                     'enabled', r.enabled,
                     'scope', r.scope,
                     'threshold', r.threshold
                   ) order by r.created_at, r.kind
                 ), '[]'::jsonb) as value
            from alert_rule r
        ),
        backup_row as (
          select
            (select max(o.completed_at)
               from pipeline_outbox o
              where o.stage = 'backup' and o.completed_at is not null)
              as last_success_at,
            -- Só a falha que veio depois do último sucesso: uma falha antiga,
            -- já superada por um backup que deu certo, não é o estado de hoje.
            f.failed_at as last_failure_at,
            f.error as last_failure_error,
            exists (
              select 1 from pipeline_outbox o
               where o.stage = 'backup'
                 and o.completed_at is null
                 and o.failed_at is null
            ) as pending
            from (select 1) one
            left join lateral (
              select o.failed_at, o.error
                from pipeline_outbox o
               where o.stage = 'backup'
                 and o.failed_at is not null
                 and o.failed_at > coalesce((
                       select max(ok.completed_at)
                         from pipeline_outbox ok
                        where ok.stage = 'backup' and ok.completed_at is not null
                     ), '-infinity'::timestamptz)
               order by o.failed_at desc
               limit 1
            ) f on true
        )
        select (select value from portfolio_json) as portfolios,
               (select value from archived_json) as archived_portfolios,
               (select value from category_json) as categories,
               (select value from institution_json) as institutions,
               (select value from benchmark_json) as benchmarks,
               (select value from alert_json) as alerts,
               (select to_jsonb(b) from backup_row b) as backup
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
