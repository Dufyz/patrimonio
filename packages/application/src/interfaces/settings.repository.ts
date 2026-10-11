import type { DateOnly } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * A leitura da tela de Configurações, em **uma** consulta.
 *
 * A carteira é um cadastro e precisa do que a prende — quantos lançamentos,
 * quantos ativos, quantas estratégias — para a tela explicar um bloqueio antes de o usuário esbarrar
 * nele. Uma consulta por linha de cadastro faria a abertura
 * crescer com o tamanho do livro; o banco fica em outra rede.
 *
 * O repositório entrega fatos e contagens. A ordem e
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
  readonly alerts: readonly SettingsAlertRuleRow[];
  readonly backup: SettingsBackupRow;
};

export type SettingsRepository = {
  readonly snapshot: () => Promise<Either<AppError, SettingsSnapshot>>;
};
