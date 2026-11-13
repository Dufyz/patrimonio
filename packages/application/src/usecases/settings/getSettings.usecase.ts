import { describeBenchmark, settlementBusinessDays } from '@patrimonio/domain';
import { either } from '@patrimonio/shared';

import type { SettingsRepository } from '../../interfaces/settings.repository.js';

/**
 * T-08 · Configurações. O caso de uso monta o que o banco leu na forma que a
 * tela desenha, e decide o que o banco não decide:
 *
 * - **A regra de liquidação é a do domínio.** A tela a lista, e não a escreve:
 *   `settlementBusinessDays` é a mesma função que sugere a data no lançamento.
 * - **O que é do ambiente chega como leitura.** A alíquota do JCP e a janela do
 *   desfazer vêm de configuração de implantação; `editable: false` diz à tela
 *   que não há botão de salvar para elas.
 */
/** Domingo é o semanal e o dia 1 é o mensal: é o que a retenção guarda (BKP-02). */
export const backupKind = (
  takenOn: string,
  manual: boolean,
): 'daily' | 'weekly' | 'monthly' | 'manual' => {
  if (manual) return 'manual';
  if (takenOn.endsWith('-01')) return 'monthly';
  return new Date(`${takenOn}T00:00:00.000Z`).getUTCDay() === 0 ? 'weekly' : 'daily';
};

export type GetSettingsDeps = {
  readonly settings: SettingsRepository;
  readonly undoWindowSeconds: number;
  readonly jcpWithholdingPct: number;
  readonly backupEnabled: boolean;
};

export const getSettings = (deps: GetSettingsDeps) =>
  either(async function* () {
    const snapshot = yield* await deps.settings.snapshot();

    const backup = snapshot.backup;

    return {
      portfolios: snapshot.portfolios.map((portfolio) => ({
        id: portfolio.id,
        name: portfolio.name,
        benchmark: describeBenchmark(portfolio.benchmark),
        strategy_categories: portfolio.strategy_categories,
        goal: portfolio.goal,
        blocking: { transactions: portfolio.transactions, assets: portfolio.assets },
        value: portfolio.value,
        updated_at: portfolio.updated_at,
      })),
      archived_portfolios: [...snapshot.archived_portfolios],
      ledger_defaults: {
        undo_window_seconds: deps.undoWindowSeconds,
        // `number` só até aqui: é percentual de configuração, e vira texto.
        jcp_withholding_pct: String(deps.jcpWithholdingPct),
        settlement: [
          {
            label: 'Ações e FIIs',
            business_days: settlementBusinessDays('stock', 'market'),
          },
          {
            label: 'Tesouro',
            business_days: settlementBusinessDays('treasury', 'market'),
          },
          { label: 'RF bancária', business_days: settlementBusinessDays(null, 'manual') },
        ],
        editable: false as const,
      },
      backup: {
        enabled: deps.backupEnabled,
        last_success_at: backup.last_success_at,
        last_failure:
          backup.last_failure_at === null
            ? null
            : {
                at: backup.last_failure_at,
                error: backup.last_failure_error ?? 'sem mensagem de erro',
              },
        pending: backup.pending,
        files: backup.files.map((file) => ({
          name: file.name,
          taken_on: file.taken_on,
          kind: backupKind(file.taken_on, file.manual),
          bytes: file.bytes,
          schema_version: file.schema_version,
        })),
      },
    };
  });
