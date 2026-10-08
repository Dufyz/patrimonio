/**
 * O orçamento de requisições de uma fonte. Existe porque estourar o teto de um
 * plano gratuito não dá erro bonito: a fonte começa a responder 429, o
 * fechamento do dia não fecha, e o patrimônio daquele dia fica errado até
 * alguém notar.
 *
 * Com trinta ativos o consumo fica perto de mil por mês contra quinze mil de
 * teto — sobra espaço para quinze vezes mais ativos. O número não é apertado
 * hoje, e a conta existe para continuar não sendo: é ela que avisa quando a
 * carteira cresceu o suficiente para apertar, antes de apertar.
 *
 * Função pura: o consumo acumulado entra como parâmetro, lido de
 * `market_source_run` pelo caso de uso.
 */
export type Budget = {
  readonly source: string;
  /** Requisições já consumidas na janela. */
  readonly used: number;
  readonly ceiling: number;
  readonly remaining: number;
  /** Fração do teto, de 0 a 1 e além dele quando estourou. */
  readonly ratio: number;
  /** Passou de 80%: ainda coleta, e já é hora de olhar. */
  readonly warning: boolean;
  readonly exceeded: boolean;
};

export const WARNING_RATIO = 0.8;

export const budgetFor = (input: {
  readonly source: string;
  readonly used: number;
  readonly ceiling: number;
}): Budget => {
  const ceiling = Math.max(0, input.ceiling);
  const used = Math.max(0, input.used);
  const ratio = ceiling === 0 ? 0 : used / ceiling;

  return {
    source: input.source,
    used,
    ceiling,
    remaining: Math.max(0, ceiling - used),
    ratio,
    warning: ceiling > 0 && ratio >= WARNING_RATIO,
    exceeded: ceiling > 0 && used >= ceiling,
  };
};

/**
 * Quantas requisições uma coleta diária consome num mês, dado o tamanho da
 * carteira. É o que responde "quando isso vira problema" sem esperar virar.
 */
export const monthlyProjection = (input: {
  readonly requestsPerCollection: number;
  readonly businessDaysPerMonth: number;
  /** Folga para retentativa e coleta extra. */
  readonly overheadRatio?: number | undefined;
}): number => {
  const overhead = 1 + (input.overheadRatio ?? 0.3);

  return Math.ceil(input.requestsPerCollection * input.businessDaysPerMonth * overhead);
};
