import { Decimal } from 'decimal.js';

/**
 * A série de preço ajustada por evento corporativo, **só para exibição**.
 *
 * `asset_price` guarda o preço como foi negociado na data, sem ajuste, e o
 * patrimônio histórico usa esse número. Isso não distorce nada, e a razão é o
 * próprio modelo: `position_daily` de 2015 usa a quantidade que havia em 2015,
 * também anterior ao desdobramento. Preço não ajustado vezes quantidade não
 * ajustada dá o valor correto, porque o livro guarda o evento e as duas pontas
 * mudam no mesmo dia.
 *
 * O gráfico de preço do ativo é o único lugar que precisa de outra coisa. Nele,
 * um desdobramento 1:2 aparece como uma queda de 50% que não aconteceu, e a
 * série ajustada existe para isso — com a legenda dizendo que é ajustada.
 *
 * Guardar o preço bruto e ajustar na leitura mantém o dado fiel à fonte e deixa
 * o ajuste refazível quando um evento for corrigido. Gravar ajustado tornaria
 * cada correção de evento uma reescrita de dez anos de preço.
 */
const PRICE_DP = 8;

const Big = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export type PricePoint = {
  /** `YYYY-MM-DD` */
  readonly price_date: string;
  readonly close: string;
};

export type PriceEvent = {
  readonly record_date: string;
  /** `ratio_from` para `ratio_to`: 1 para 2 é desdobramento, 10 para 1 é grupamento. */
  readonly ratio_from: string;
  readonly ratio_to: string;
};

export type AdjustedPoint = PricePoint & {
  /** O preço ajustado, comparável com o de hoje. */
  readonly adjusted_close: string;
  /** O fator acumulado aplicado. 1 quando nenhum evento afeta aquela data. */
  readonly factor: string;
};

export type AdjustedSeries = {
  readonly points: readonly AdjustedPoint[];
  /** Os fatores aplicados, que é o que a tabela de eventos do ativo lista. */
  readonly applied: readonly { readonly record_date: string; readonly factor: string }[];
};

/**
 * O fator de um evento, na direção da exibição: um desdobramento 1:2 divide o
 * preço anterior por 2, para a série ficar comparável com o preço de hoje.
 */
const factorOf = (event: PriceEvent): Decimal => {
  const from = new Big(event.ratio_from);
  const to = new Big(event.ratio_to);

  if (from.isZero() || to.isZero()) return new Big(1);

  return from.dividedBy(to);
};

/**
 * Ajusta a série para trás, acumulando os eventos posteriores a cada data.
 *
 * A direção importa: o preço de **hoje** nunca é ajustado — ele é o preço real —
 * e é o passado que é trazido para a escala de hoje. Ajustar para frente daria
 * uma série em que o último ponto não é o preço que está na tela, e aí o gráfico
 * contradiz a tabela de posições logo acima dele.
 */
export const adjustForEvents = (
  points: readonly PricePoint[],
  events: readonly PriceEvent[],
): AdjustedSeries => {
  const ordered = [...points].sort((left, right) =>
    left.price_date < right.price_date ? -1 : left.price_date > right.price_date ? 1 : 0,
  );

  const relevant = [...events].sort((left, right) =>
    left.record_date < right.record_date
      ? -1
      : left.record_date > right.record_date
        ? 1
        : 0,
  );

  const adjusted: AdjustedPoint[] = ordered.map((point) => {
    // O fator de um ponto é o produto dos eventos que vieram **depois** dele.
    let factor = new Big(1);

    for (const event of relevant) {
      if (event.record_date > point.price_date) factor = factor.times(factorOf(event));
    }

    return {
      price_date: point.price_date,
      close: point.close,
      adjusted_close: new Big(point.close)
        .times(factor)
        .toDecimalPlaces(PRICE_DP)
        .toFixed(PRICE_DP),
      factor: factor.toDecimalPlaces(PRICE_DP).toFixed(PRICE_DP),
    };
  });

  return {
    points: adjusted,
    applied: relevant.map((event) => ({
      record_date: event.record_date,
      factor: factorOf(event).toDecimalPlaces(PRICE_DP).toFixed(PRICE_DP),
    })),
  };
};
