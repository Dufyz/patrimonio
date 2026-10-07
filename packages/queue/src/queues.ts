import type { Stage } from '@patrimonio/domain';

/**
 * Seis filas, uma por estágio. A concorrência é declarada aqui, não no código
 * do processor: a do recálculo é 1 de propósito — a trava de carteira já
 * serializa, e paralelismo ali só produziria espera.
 */
export const QUEUE_NAMES = {
  recalc: 'recalc',
  market: 'market',
  close: 'close',
  alerts: 'alerts',
  import: 'import',
  backup: 'backup',
} as const satisfies Record<Stage, string>;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type QueueDeclaration = {
  readonly name: QueueName;
  readonly concurrency: number;
  /**
   * Expressão cron do job repetível, em horário de São Paulo. O job agendado
   * só insere o evento na outbox; o relay é quem despacha, e assim o histórico
   * de execução fica no Postgres e sobrevive a um FLUSHALL.
   */
  readonly schedule?: readonly string[];
};

export const SCHEDULE_TIMEZONE = 'America/Sao_Paulo';

export const QUEUES: Record<Stage, QueueDeclaration> = {
  // Sob demanda, pela outbox.
  recalc: { name: QUEUE_NAMES.recalc, concurrency: 1 },
  // Dias úteis, 18:30 e 09:00.
  market: {
    name: QUEUE_NAMES.market,
    concurrency: 2,
    schedule: ['30 18 * * 1-5', '0 9 * * 1-5'],
  },
  // Dias úteis, 19:00 — depois dos preços.
  close: { name: QUEUE_NAMES.close, concurrency: 1, schedule: ['0 19 * * 1-5'] },
  // Dias úteis, 19:15 — depois do fechamento.
  alerts: { name: QUEUE_NAMES.alerts, concurrency: 1, schedule: ['15 19 * * 1-5'] },
  import: { name: QUEUE_NAMES.import, concurrency: 1 },
  // Diário, 03:00.
  backup: { name: QUEUE_NAMES.backup, concurrency: 1, schedule: ['0 3 * * *'] },
};

export const ALL_QUEUES: readonly QueueDeclaration[] = Object.values(QUEUES);
