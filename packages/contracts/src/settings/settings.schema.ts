import { z } from 'zod';

import { dateOnly, decimalString, uuid } from '../support/primitives.schema.js';

/**
 * T-08 · Configurações: as seções de ajuste, cada uma resolvendo uma coisa.
 *
 * A resposta é uma só para a tela inteira — carteiras, o que o
 * lançamento preenche sozinho e o backup — e
 * não uma por seção, porque a prancha mostra tudo na mesma rolagem e o banco fica em outra
 * rede. A seção de dados de mercado **não** está aqui: ela já tem a sua rota
 * (`GET /market/health`, M-16), com compasso próprio de releitura enquanto uma
 * coleta roda, e duplicá-la seria ter dois lugares que dizem se o preço é de hoje.
 *
 * Decisões que o contrato fixa:
 *
 * - **Bloqueio de exclusão vem com a contagem.** A carteira
 *   traz o que a prende (`blocking`), e a tela escreve "41
 *   lançamentos impedem" em vez de deixar o usuário descobrir pelo erro. A
 *   regra de bloquear é do servidor; a contagem é só para explicá-la.
 * - **Dinheiro e percentual são string.** O caixa e os totais chegam
 *   prontos, porque a tela não faz conta com dinheiro.
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
export type SettingsBackup = z.infer<typeof settingsBackupSchema>;

/** A frase que o usuário digita para apagar tudo: o atrito é proporcional ao estrago. */
export const DELETE_ALL_PHRASE = 'APAGAR TUDO';

/** "Exportar tudo": o arquivo sai inteiro, sem filtro. */
export const exportDataSchema = z.object({});

export const deleteAllDataSchema = z.object({
  body: z.object({ confirmation: z.literal(DELETE_ALL_PHRASE) }),
});

export const deleteAllDataResultSchema = z.object({
  deleted_transactions: z.number().int(),
  deleted_portfolios: z.number().int(),
  deleted_assets: z.number().int(),
  deleted_institutions: z.number().int(),
  message: z.string(),
});
