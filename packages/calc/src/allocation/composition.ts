import { Decimal } from 'decimal.js';

import { sumTargets } from './targets.js';
import type { TargetSum } from './targets.js';
import { deviationPp, weightPct } from './weights.js';

/**
 * A composição real contra o alvo, em dois níveis: o grupo é a soma das categorias
 * dentro dele, e não um número guardado em paralelo. Guardar o total do grupo
 * criaria a possibilidade de ele divergir das partes, que é a classe de bug que
 * faz a tela mostrar 101%.
 *
 * O desvio sai em pontos percentuais com sinal, porque é o que é acionável:
 * "faltam 4 pp em renda fixa" diz o que fazer; "renda fixa está em 26%" não diz.
 */
const MONEY_DP = 2;

const zero = new Decimal(0);

export type AllocationLine = {
  readonly category_id: string;
  readonly category_name: string;
  /** Nulo quando a categoria é de primeiro nível. */
  readonly group_id: string | null;
  readonly group_name: string | null;
  /** Valor de mercado da categoria na carteira. */
  readonly value: string;
};

export type CompositionTarget = {
  readonly category_id: string;
  readonly target_pct: string;
};

export type CompositionOptions = {
  /** Tolerância de desvio da carteira, em pontos percentuais. */
  readonly tolerance_pp?: string | undefined;
};

export type CompositionNode = {
  readonly id: string;
  readonly name: string;
  readonly level: 'group' | 'category';
  readonly value: string;
  readonly current_pct: string;
  /** Nulo quando não há alvo: a coluna de desvio fica vazia, não zerada. */
  readonly target_pct: string | null;
  readonly deviation_pp: string | null;
  readonly over_tolerance: boolean;
  /** Quanto mover para chegar ao alvo. Positivo é comprar. */
  readonly amount_to_move: string | null;
  /**
   * O valor que a linha teria no alvo. Vem pronto porque a tela não faz conta
   * com dinheiro: ela mostra a coluna "no alvo" sem somar `value` e
   * `amount_to_move`.
   */
  readonly target_value: string | null;
  readonly children: readonly CompositionNode[];
};

export type Composition = {
  readonly total: string;
  readonly nodes: readonly CompositionNode[];
  readonly target_sum: TargetSum;
  /** Verdadeiro quando o alvo declarado não fecha 100% nem está vazio. */
  readonly target_rejected: boolean;
};

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

const sum = (values: readonly string[]): Decimal =>
  values.reduce((total, value) => total.plus(new Decimal(value)), zero);

type Resolved = {
  readonly current_pct: string;
  readonly target_pct: string | null;
  readonly deviation_pp: string | null;
  readonly over_tolerance: boolean;
  readonly amount_to_move: string | null;
  readonly target_value: string | null;
};

const resolve = (
  value: Decimal,
  total: Decimal,
  target: string | null,
  tolerance: Decimal | null,
): Resolved => {
  const currentPct = weightPct(money(value), money(total));

  if (target === null) {
    return {
      current_pct: currentPct,
      target_pct: null,
      deviation_pp: null,
      over_tolerance: false,
      amount_to_move: null,
      target_value: null,
    };
  }

  const deviation = deviationPp(currentPct, target);
  const wanted = total.times(new Decimal(target)).dividedBy(100);

  return {
    current_pct: currentPct,
    target_pct: new Decimal(target).toFixed(2),
    deviation_pp: deviation,
    over_tolerance:
      tolerance !== null && new Decimal(deviation).abs().greaterThan(tolerance),
    amount_to_move: money(wanted.minus(value)),
    target_value: money(wanted),
  };
};

/**
 * A composição em dois níveis. Categoria sem grupo entra na raiz como ela mesma:
 * forçar um grupo artificial só para ter dois níveis sempre criaria uma linha que
 * não existe no cadastro.
 */
export const composeAllocation = (
  lines: readonly AllocationLine[],
  targets: readonly CompositionTarget[],
  options: CompositionOptions = {},
): Composition => {
  const total = sum(lines.map((line) => line.value));
  const tolerance =
    options.tolerance_pp === undefined ? null : new Decimal(options.tolerance_pp);

  const targetByCategory = new Map(
    targets.map((target) => [target.category_id, target.target_pct]),
  );

  const categoryNode = (line: AllocationLine): CompositionNode => {
    const value = new Decimal(line.value);
    const target = targetByCategory.get(line.category_id) ?? null;

    return {
      id: line.category_id,
      name: line.category_name,
      level: 'category',
      value: money(value),
      ...resolve(value, total, target, tolerance),
      children: [],
    };
  };

  const groups = new Map<string, { name: string; lines: AllocationLine[] }>();
  const roots: CompositionNode[] = [];

  for (const line of lines) {
    if (line.group_id === null) {
      roots.push(categoryNode(line));
      continue;
    }

    const bucket = groups.get(line.group_id) ?? {
      name: line.group_name ?? line.group_id,
      lines: [],
    };
    bucket.lines.push(line);
    groups.set(line.group_id, bucket);
  }

  for (const [groupId, bucket] of groups) {
    const children = bucket.lines.map(categoryNode);
    const value = sum(bucket.lines.map((line) => line.value));

    // O alvo do grupo é a soma dos alvos das categorias dentro dele. Se nenhuma
    // tem alvo, o grupo também não tem — e a coluna de desvio fica vazia.
    const declared = bucket.lines
      .map((line) => targetByCategory.get(line.category_id))
      .filter((target): target is string => target !== undefined);

    const groupTarget = declared.length === 0 ? null : sum(declared).toFixed(2);

    roots.push({
      id: groupId,
      name: bucket.name,
      level: 'group',
      value: money(value),
      ...resolve(value, total, groupTarget, tolerance),
      children: children.sort(byValueDesc),
    });
  }

  const targetSum = sumTargets(
    targets.map((target) => ({
      category_id: target.category_id,
      target_pct: target.target_pct,
    })),
  );

  return {
    total: money(total),
    nodes: roots.sort(byValueDesc),
    target_sum: targetSum,
    target_rejected: !targetSum.closes,
  };
};

const byValueDesc = (left: CompositionNode, right: CompositionNode): number =>
  new Decimal(right.value).comparedTo(new Decimal(left.value));

/**
 * As linhas que estouraram a tolerância, que é o que alimenta o alerta de desvio.
 * A ordem é pelo tamanho do desvio: o maior problema primeiro.
 */
export const outOfTolerance = (composition: Composition): readonly CompositionNode[] => {
  const found: CompositionNode[] = [];

  const walk = (nodes: readonly CompositionNode[]): void => {
    for (const node of nodes) {
      if (node.over_tolerance) found.push(node);
      walk(node.children);
    }
  };

  walk(composition.nodes);

  return found.sort((left, right) =>
    new Decimal(right.deviation_pp ?? '0')
      .abs()
      .comparedTo(new Decimal(left.deviation_pp ?? '0').abs()),
  );
};
