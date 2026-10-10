import { Decimal } from 'decimal.js';

import { calendarDaysBetween } from '../support/dates.js';

/**
 * Retorno de uma classe de ativo: Dietz modificado.
 *
 * A carteira tem cota, e a cota é o retorno exato — o aporte entra ao valor de
 * cota do dia anterior e não mexe nele. Uma **classe** não tem cota: as ações de
 * uma carteira recebem dinheiro quando se compra e devolvem quando se vende, e
 * ninguém grava quantas cotas "de ações" existem. O que se mede é o valor no
 * começo, o valor no fim e o que entrou e saiu no meio.
 *
 *     retorno = (fim − começo − fluxo + proventos) / (começo + Σ peso × fluxo)
 *
 * O peso de cada fluxo é a fração do período em que o dinheiro esteve na classe:
 * uma compra no primeiro dia pesa quase 1; uma no último pesa quase 0. Sem o
 * peso, comprar na véspera do fim do período contaria como capital investido o
 * período todo e diluiria o retorno.
 *
 * É uma aproximação do retorno ponderado pelo tempo, e a tela diz isso. A
 * diferença para o retorno exato cresce quando o fluxo é grande e a volatilidade
 * do meio do período também — e é por isso que a carteira, que tem cota, nunca
 * usa este método.
 *
 * Fluxo positivo é dinheiro que entrou na classe (compra); negativo é o que saiu (venda, amortização). Provento não é fluxo:
 * ele é resultado da classe que foi pago em caixa, e entra somando no numerador.
 */
export type DietzFlow = {
  /** `YYYY-MM-DD`, dentro do período: depois da base e até o fim. */
  readonly date: string;
  readonly amount: string;
};

export type DietzInput = {
  readonly start_date: string;
  readonly end_date: string;
  readonly start_value: string;
  readonly end_value: string;
  readonly flows: readonly DietzFlow[];
  /** Proventos recebidos no período. */
  readonly income: string;
};

const PCT_DP = 2;

const zero = new Decimal(0);

/**
 * Nulo quando o período não existe (fim não depois da base) ou quando a classe
 * não teve capital nenhum no período: dividir por zero devolveria um número, e o
 * número seria inventado.
 */
export const modifiedDietz = (input: DietzInput): string | null => {
  const days = calendarDaysBetween(input.start_date, input.end_date);
  if (days <= 0) return null;

  const start = new Decimal(input.start_value);
  const end = new Decimal(input.end_value);

  let flow = zero;
  let weighted = zero;

  for (const entry of input.flows) {
    const amount = new Decimal(entry.amount);
    const elapsed = calendarDaysBetween(input.start_date, entry.date);
    // Fluxo fora do período não pertence a ele: contá-lo deslocaria o numerador
    // sem entrar no capital.
    if (elapsed <= 0 || elapsed > days) continue;

    flow = flow.plus(amount);
    weighted = weighted.plus(amount.times(new Decimal(days - elapsed).dividedBy(days)));
  }

  const capital = start.plus(weighted);
  if (capital.lte(0)) return null;

  return end
    .minus(start)
    .minus(flow)
    .plus(new Decimal(input.income))
    .dividedBy(capital)
    .times(100)
    .toDecimalPlaces(PCT_DP)
    .toFixed(PCT_DP);
};
