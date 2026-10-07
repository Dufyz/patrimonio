import type { OutboxEventDraft, Stage } from '@patrimonio/domain';

/**
 * A coalescência resolve o caso que acontece todo dia: lançar cinco operações
 * seguidas na mesma carteira tem de produzir **um** recálculo, não cinco. O índice
 * único parcial da outbox já garante que exista no máximo um pendente por chave; o
 * que falta é não despachar esse pendente antes de a rajada terminar.
 *
 * Duas datas fazem isso:
 *
 * - `available_at` é a espera. Cada novo pedido da rajada a empurra para frente,
 *   então o relay não pega o evento no meio da sequência de cliques.
 * - `debounce_until` é o teto, calculado no **primeiro** pedido. Sem ele, alguém
 *   lançando sem parar adiaria o recálculo para sempre, e o patrimônio da tela
 *   nunca atualizaria.
 *
 * Só os estágios que coalescem recebem espera. Fechamento, alertas e backup nascem
 * de um agendamento: eles já têm hora, e atrasá-los não junta nada.
 */
export type DebounceConfig = {
  /** Quanto esperar por um novo pedido antes de despachar. */
  readonly waitMs: number;
  /** Teto da espera renovada, contado do primeiro pedido da rajada. */
  readonly maxMs: number;
};

/** Estágios cujos pedidos chegam em rajada, disparados pelo usuário. */
const COALESCING: ReadonlySet<Stage> = new Set<Stage>(['recalc', 'market']);

export const coalesces = (stage: Stage): boolean => COALESCING.has(stage);

export type DebouncePolicy = (draft: OutboxEventDraft) => OutboxEventDraft;

/**
 * O relógio entra por parâmetro: nenhuma função de política chama `new Date()`, e é
 * o que permite ao teste empurrar a rajada no tempo sem esperar de verdade.
 */
export const createDebouncePolicy = (
  config: DebounceConfig,
  now: () => Date,
): DebouncePolicy =>
  (draft: OutboxEventDraft): OutboxEventDraft => {
    if (!coalesces(draft.stage)) return draft;

    // Uma data já declarada pelo plano vence a política: há casos em que o atraso
    // é parte do pedido, e não uma espera por rajada.
    if (draft.available_at !== undefined) return draft;

    const reference = now().getTime();

    return {
      ...draft,
      available_at: new Date(reference + config.waitMs),
      debounce_until: new Date(reference + config.maxMs),
    };
  };
