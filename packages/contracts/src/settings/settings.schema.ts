import { z } from 'zod';

import { dateOnly, decimalString, uuid } from '../support/primitives.schema.js';

/**
 * T-08 · Configurações: as oito seções de ajuste, cada uma resolvendo uma coisa.
 *
 * A resposta é uma só para a tela inteira — carteiras, alertas, categorias,
 * instituições, o que o lançamento preenche sozinho e o backup — e
 * não oito, porque a prancha mostra tudo na mesma rolagem e o banco fica em outra
 * rede. A seção de dados de mercado **não** está aqui: ela já tem a sua rota
 * (`GET /market/health`, M-16), com compasso próprio de releitura enquanto uma
 * coleta roda, e duplicá-la seria ter dois lugares que dizem se o preço é de hoje.
 *
 * Quatro decisões que o contrato fixa:
 *
 * - **Bloqueio de exclusão vem com a contagem.** Carteira, categoria e
 *   instituição trazem o que as prende (`blocking`), e a tela escreve "41
 *   lançamentos impedem" em vez de deixar o usuário descobrir pelo erro. A
 *   regra de bloquear é do servidor; a contagem é só para explicá-la.
 * - **Dinheiro e percentual são string.** Caixa, exposição e limite do FGC
 *   chegam prontos, inclusive o percentual da barra, porque a tela não faz
 *   conta com dinheiro.
 * - **Alerta traz o limite como veio.** `threshold` é o `jsonb` da regra, sem
 *   interpretação: cada regra tem a forma dela, e quem a traduz em texto é a
 *   tela, a partir do `kind`. Regra "da carteira" vem com `scope:
 *   'per_portfolio'` e sem limite próprio — ele vive em cada carteira.
 * - **O que é do ambiente chega como leitura.** A janela do desfazer e a
 *   alíquota do IR em JCP são configuração de implantação, não preferência
 *   gravada: a seção as mostra, e `editable: false` diz que mudá-las é trocar a
 *   variável de ambiente.
 */

export const settingsPortfolioSchema = z.object({
  id: uuid,
  name: z.string(),
  benchmark: z.object({ value: z.string(), name: z.string() }).nullable(),
  /** Quantas categorias a estratégia da carteira usa. */
  strategy_categories: z.number().int(),
  /** Os objetivos abertos que a medem, por nome. */
  goals: z.array(z.string()),
  /** O que impede a exclusão: lançamentos e os ativos distintos deles. */
  blocking: z.object({
    transactions: z.number().int(),
    assets: z.number().int(),
  }),
});

export const settingsArchivedPortfolioSchema = z.object({
  id: uuid,
  name: z.string(),
  archived_on: dateOnly,
});

export const settingsAlertRuleSchema = z.object({
  kind: z.string(),
  enabled: z.boolean(),
  scope: z.enum(['global', 'per_portfolio']),
  threshold: z.record(z.string(), z.unknown()).nullable(),
});

export const settingsCategorySchema = z.object({
  id: uuid,
  parent_id: uuid.nullable(),
  name: z.string(),
  color_token: z.string(),
  auto_rule: z.record(z.string(), z.unknown()).nullable(),
  sort_order: z.number().int(),
  /** Ativos nesta categoria. No grupo, a soma das categorias dentro dele. */
  assets: z.number().int(),
  /** Carteiras cuja estratégia usa a categoria. No grupo, as distintas. */
  strategies: z.number().int(),
  /** Categorias filhas: um grupo com filhas não se exclui. */
  children: z.number().int(),
});

export const settingsInstitutionSchema = z.object({
  id: uuid,
  name: z.string(),
  role: z.enum(['custodian', 'issuer', 'both']),
  fgc_covered: z.boolean(),
  brokerage_per_order: decimalString,
  custody_monthly_fee: decimalString,
  /** As carteiras com lançamento nesta instituição, por nome. */
  portfolios: z.array(z.string()),
  /** O saldo de caixa que a instituição guarda. Nulo quando ela não guarda. */
  cash: decimalString.nullable(),
  /**
   * A exposição de quem a instituição emite contra o limite do FGC. Nulo quando
   * ela não é emissora, ou não é coberta — e `fgc_covered` diz qual dos dois.
   */
  fgc: z
    .object({
      exposure: decimalString,
      limit: decimalString,
      /** Exposição sobre o limite, em pontos percentuais, para a barra. */
      used_pct: decimalString,
      over_limit: z.boolean(),
    })
    .nullable(),
  /** O que impede a exclusão. */
  blocking: z.object({
    transactions: z.number().int(),
    assets: z.number().int(),
  }),
});

export const settingsBackupSchema = z.object({
  /** Falso quando a instalação não ligou o backup: a seção diz isso. */
  enabled: z.boolean(),
  last_success_at: z.string().nullable(),
  /** A última falha que veio depois do último sucesso. Nula quando não há. */
  last_failure: z.object({ at: z.string(), error: z.string() }).nullable(),
  /** Há um pedido de backup esperando o relay ou rodando agora. */
  pending: z.boolean(),
});

export const settingsLedgerDefaultsSchema = z.object({
  undo_window_seconds: z.number().int(),
  jcp_withholding_pct: decimalString,
  /** Dias úteis de liquidação por tipo, na ordem em que a tela os lista. */
  settlement: z.array(z.object({ label: z.string(), business_days: z.number().int() })),
  editable: z.literal(false),
});

export const settingsSchema = z.object({
  portfolios: z.array(settingsPortfolioSchema),
  archived_portfolios: z.array(settingsArchivedPortfolioSchema),
  alerts: z.array(settingsAlertRuleSchema),
  categories: z.array(settingsCategorySchema),
  institutions: z.array(settingsInstitutionSchema),
  ledger_defaults: settingsLedgerDefaultsSchema,
  backup: settingsBackupSchema,
});

export const getSettingsSchema = z.object({});

/** "Fazer backup agora": enfileira e devolve na hora, como "atualizar agora". */
export const runBackupSchema = z.object({});

export const backupQueuedSchema = z.object({
  job_id: uuid,
  already_queued: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPortfolio = z.infer<typeof settingsPortfolioSchema>;
export type SettingsCategory = z.infer<typeof settingsCategorySchema>;
export type SettingsInstitution = z.infer<typeof settingsInstitutionSchema>;
export type SettingsAlertRule = z.infer<typeof settingsAlertRuleSchema>;
export type SettingsBackup = z.infer<typeof settingsBackupSchema>;
