import type { DateOnly } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * A leitura da tela de Configurações, em **uma** consulta.
 *
 * As carteiras, as categorias e as instituições são cadastros, e
 * cada um precisa do que o prende — quantos lançamentos, quantos ativos, quantas
 * estratégias — para a tela explicar um bloqueio antes de o usuário esbarrar
 * nele. Uma consulta por cadastro, e por linha de cadastro, faria a abertura
 * crescer com o tamanho do livro; o banco fica em outra rede.
 *
 * O repositório entrega fatos e contagens. Percentual do FGC, ordem dos grupos e
 * o texto de cada bloqueio são do caso de uso e da tela.
 */
export type SettingsPortfolioRow = {
  readonly id: string;
  readonly name: string;
  readonly benchmark: string | null;
  readonly strategy_categories: number;
  readonly goals: readonly string[];
  readonly transactions: number;
  readonly assets: number;
};

export type SettingsArchivedPortfolioRow = {
  readonly id: string;
  readonly name: string;
  readonly archived_on: DateOnly;
};

export type SettingsCategoryRow = {
  readonly id: string;
  readonly parent_id: string | null;
  readonly name: string;
  readonly color_token: string;
  readonly auto_rule: Record<string, unknown> | null;
  readonly sort_order: number;
  /** Ativos nesta categoria; no grupo, nas categorias dentro dele. */
  readonly assets: number;
  /** Carteiras com alvo nesta categoria; no grupo, as distintas dentro dele. */
  readonly strategies: number;
  readonly children: number;
};

export type SettingsInstitutionRow = {
  readonly id: string;
  readonly name: string;
  readonly role: 'custodian' | 'issuer' | 'both';
  readonly fgc_covered: boolean;
  readonly brokerage_per_order: string;
  readonly custody_monthly_fee: string;
  readonly portfolios: readonly string[];
  /** A soma do último valor de cada caixa da instituição. Nulo sem caixa. */
  readonly cash: string | null;
  /** Aplicado menos resgatado nos títulos manuais que ela emite. */
  readonly issuer_exposure: string;
  readonly issued_assets: number;
  readonly transactions: number;
  readonly assets: number;
};

export type SettingsAlertRuleRow = {
  readonly kind: string;
  readonly enabled: boolean;
  readonly scope: 'global' | 'per_portfolio';
  readonly threshold: Record<string, unknown> | null;
};

/** O que a tabela do pipeline sabe do backup. O bucket só o worker enxerga. */
export type SettingsBackupRow = {
  readonly last_success_at: string | null;
  readonly last_failure_at: string | null;
  readonly last_failure_error: string | null;
  readonly pending: boolean;
};

export type SettingsSnapshot = {
  readonly portfolios: readonly SettingsPortfolioRow[];
  readonly archived_portfolios: readonly SettingsArchivedPortfolioRow[];
  readonly categories: readonly SettingsCategoryRow[];
  readonly institutions: readonly SettingsInstitutionRow[];
  readonly alerts: readonly SettingsAlertRuleRow[];
  readonly backup: SettingsBackupRow;
};

export type SettingsRepository = {
  readonly snapshot: () => Promise<Either<AppError, SettingsSnapshot>>;
};
