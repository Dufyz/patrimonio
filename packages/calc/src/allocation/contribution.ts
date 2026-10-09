import { Decimal } from 'decimal.js';

/**
 * Onde aplicar o próximo aporte para reduzir o desvio. O aporte só compra: a
 * regra "só com aportes" da carteira diz que o plano nunca sugere venda, e vender
 * para rebalancear tem imposto — é decisão de quem lê, não sugestão da tela.
 *
 * O cálculo mira o patrimônio **depois** do aporte. Cada categoria abaixo do
 * alvo tem uma falta (`alvo × (total + aporte) − valor`), e o aporte é repartido
 * em proporção a essa falta. Se a falta somada for menor que o aporte, cada uma
 * recebe exatamente o que falta e o resto não é alocado: sugerir comprar mais
 * do que o alvo pede abriria um desvio no outro sentido.
 *
 * Categoria sem alvo não recebe nada, mas o valor dela entra no total: ela é
 * patrimônio, e ignorá-la inflaria o que as outras precisam receber.
 */
const MONEY_DP = 2;
const CENT = new Decimal('0.01');

const zero = new Decimal(0);

export type ContributionLine = {
  readonly category_id: string;
  readonly value: string;
  /** Nulo é "sem alvo": a categoria não recebe aporte. */
  readonly target_pct: string | null;
};

export type ContributionShare = {
  readonly category_id: string;
  readonly amount: string;
  /** O desvio da categoria depois do aporte, em pontos percentuais com sinal. */
  readonly deviation_after_pp: string;
};

export type ContributionPlan = {
  readonly amount: string;
  readonly allocated: string;
  /** O que o alvo não pediu. Fica em conta, não em ativo nenhum. */
  readonly unallocated: string;
  /** Só as categorias que recebem: aporte zero não aparece na lista. */
  readonly shares: readonly ContributionShare[];
  /** O maior desvio absoluto da carteira, antes e depois. Nulo sem alvo. */
  readonly max_deviation_before_pp: string | null;
  readonly max_deviation_after_pp: string | null;
};

const money = (value: Decimal): string => value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

const pp = (value: Decimal): string => value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

const percent = (value: Decimal, total: Decimal): Decimal =>
  total.isZero() ? zero : value.dividedBy(total).times(100);

/**
 * Reparte `amount` em centavos na proporção de `weights`, sem perder nem criar
 * centavo: arredonda para baixo e entrega os centavos que sobraram a quem tinha
 * a maior parte fracionária. A soma sai sempre igual ao `amount`.
 */
const splitCents = (amount: Decimal, weights: readonly Decimal[]): Decimal[] => {
  const totalWeight = weights.reduce((sum, weight) => sum.plus(weight), zero);
  if (totalWeight.isZero()) return weights.map(() => zero);

  const exact = weights.map((weight) => amount.times(weight).dividedBy(totalWeight));
  const floored = exact.map((value) => value.toDecimalPlaces(MONEY_DP, Decimal.ROUND_DOWN));

  const spent = floored.reduce((sum, value) => sum.plus(value), zero);
  let leftover = amount.minus(spent).dividedBy(CENT).toDecimalPlaces(0).toNumber();

  const order = exact
    .map((value, index) => ({ index, fraction: value.minus(floored[index] ?? zero) }))
    .sort((left, right) => right.fraction.comparedTo(left.fraction) || left.index - right.index);

  const result = [...floored];

  for (const { index } of order) {
    if (leftover <= 0) break;
    result[index] = (result[index] ?? zero).plus(CENT);
    leftover -= 1;
  }

  return result;
};

export const planContribution = (
  lines: readonly ContributionLine[],
  amount: string,
): ContributionPlan => {
  const contribution = new Decimal(amount);
  const total = lines.reduce((sum, line) => sum.plus(new Decimal(line.value)), zero);
  const after = total.plus(contribution);

  const targeted = lines.filter(
    (line): line is ContributionLine & { readonly target_pct: string } =>
      line.target_pct !== null,
  );

  if (targeted.length === 0 || !contribution.greaterThan(0)) {
    return {
      amount: money(contribution.greaterThan(0) ? contribution : zero),
      allocated: money(zero),
      unallocated: money(contribution.greaterThan(0) ? contribution : zero),
      shares: [],
      max_deviation_before_pp: null,
      max_deviation_after_pp: null,
    };
  }

  const shortfalls = targeted.map((line) => {
    const wanted = after.times(new Decimal(line.target_pct)).dividedBy(100);
    const missing = wanted.minus(new Decimal(line.value));
    return missing.greaterThan(0) ? missing : zero;
  });

  const totalShortfall = shortfalls.reduce((sum, value) => sum.plus(value), zero);

  // Falta menor que o aporte: cada uma recebe o que falta, e o resto sobra.
  // Falta maior: o aporte inteiro é repartido na proporção da falta.
  const budget = totalShortfall.lessThan(contribution) ? totalShortfall : contribution;
  const parts = splitCents(
    budget.toDecimalPlaces(MONEY_DP, Decimal.ROUND_DOWN),
    shortfalls,
  );

  const received = new Map<string, Decimal>();
  targeted.forEach((line, index) => received.set(line.category_id, parts[index] ?? zero));

  const allocated = parts.reduce((sum, value) => sum.plus(value), zero);

  const deviation = (line: ContributionLine & { readonly target_pct: string }, base: Decimal, extra: Decimal) =>
    percent(new Decimal(line.value).plus(extra), base).minus(new Decimal(line.target_pct));

  const maxAbs = (values: readonly Decimal[]): Decimal =>
    values.reduce((largest, value) => (value.abs().greaterThan(largest) ? value.abs() : largest), zero);

  const before = maxAbs(targeted.map((line) => deviation(line, total, zero)));
  const afterDeviation = targeted.map((line) =>
    deviation(line, after, received.get(line.category_id) ?? zero),
  );

  return {
    amount: money(contribution),
    allocated: money(allocated),
    unallocated: money(contribution.minus(allocated)),
    shares: targeted
      .map((line, index) => ({
        category_id: line.category_id,
        amount: money(received.get(line.category_id) ?? zero),
        deviation_after_pp: pp(afterDeviation[index] ?? zero),
      }))
      .filter((share) => new Decimal(share.amount).greaterThan(0))
      .sort((left, right) => new Decimal(right.amount).comparedTo(new Decimal(left.amount))),
    max_deviation_before_pp: pp(before),
    max_deviation_after_pp: pp(maxAbs(afterDeviation)),
  };
};
