import { composeAllocation, planContribution } from '@patrimonio/calc';
import type {
  AllocationLine,
  Composition,
  CompositionNode,
  ContributionPlan,
} from '@patrimonio/calc';
import { TOLERANCE_PP, describeBenchmark } from '@patrimonio/domain';
import type { DateOnly, RecalcStatus } from '@patrimonio/domain';
import { either, failure } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { AllocationCategoryRow } from '../../interfaces/allocation.repository.js';
import type { AllocationRepository } from '../../interfaces/allocation.repository.js';
import type { Clock } from '../../interfaces/clock.js';

/**
 * T-06 · A estratégia da carteira contra o que ela tem hoje.
 *
 * O caso de uso junta o que o banco leu — cadastro, valor por categoria, alvo —
 * e deixa o cálculo com `packages/calc`: composição em dois níveis, desvio,
 * valor a mover e a sugestão de aporte. A tela recebe tudo pronto.
 *
 * Duas decisões sobre o alvo:
 *
 * - **Com estratégia, categoria sem linha de alvo tem alvo zero.** É o que a
 *   prancha mostra — Pós-fixada em "0 %", desvio "0,0 pp" — e é o que o banco
 *   guarda: a coluna exige alvo acima de zero, então "0%" é a ausência da linha.
 *   O desvio de uma categoria com posição e sem alvo é a posição inteira, e é
 *   essa a informação que o usuário precisa para decidir.
 * - **Sem estratégia, nenhuma categoria tem alvo.** A coluna de desvio fica
 *   vazia em vez de mostrar o desvio contra um alvo que ninguém escolheu.
 */
export type GetAllocationDeps = {
  readonly allocation: AllocationRepository;
  readonly clock: Clock;
};

export type GetAllocationInput = {
  readonly portfolio_id: string;
  readonly on_date?: DateOnly | undefined;
  /** O valor a distribuir. Ausente é só a leitura da estratégia. */
  readonly contribution?: string | undefined;
};

/**
 * O nó com a cor. `composeAllocation` não conhece design system, e a tela não
 * escolhe cor por conta própria: a de uma categoria é a mesma na tabela, na
 * barra e no gráfico, e quem garante isso é `category.color_token`.
 */
export type AllocationNode = Omit<CompositionNode, 'children'> & {
  readonly color_token: string;
  readonly children: readonly AllocationNode[];
};

export type AllocationComposition = Omit<Composition, 'nodes'> & {
  readonly nodes: readonly AllocationNode[];
};

export type AllocationShare = {
  readonly category_id: string;
  readonly name: string;
  readonly color_token: string;
  readonly amount: string;
  readonly deviation_after_pp: string;
};

export type AllocationContribution = Omit<ContributionPlan, 'shares'> & {
  readonly shares: readonly AllocationShare[];
};

export type AllocationRules = {
  readonly tolerance_pp: string;
  readonly reviewed_on: DateOnly | null;
  readonly benchmark: { readonly value: string; readonly name: string } | null;
};

export type AllocationResult = {
  readonly reference_date: DateOnly | null;
  readonly portfolio: {
    readonly id: string;
    readonly name: string;
    readonly recalc_status: RecalcStatus;
  };
  readonly rules: AllocationRules;
  readonly strategy_defined: boolean;
  readonly composition: AllocationComposition;
  readonly contribution: AllocationContribution | null;
};

const FALLBACK_TOKEN = 'class.outros';
const NO_CATEGORY = 'sem-categoria';

const toLine = (row: AllocationCategoryRow): AllocationLine => ({
  category_id: row.category_id,
  category_name: row.category_name,
  group_id: row.group_id,
  group_name: row.group_name,
  value: row.value,
});

/**
 * A ordem do cadastro, não a do valor: numa tabela que se edita, a linha que
 * muda de lugar porque o valor passou da vizinha faz quem digita perder o campo.
 * O grupo herda a cor da primeira categoria dele, que é a de menor ordem.
 */
const arrange = (
  composition: Composition,
  rows: readonly AllocationCategoryRow[],
): AllocationComposition => {
  const byId = new Map(rows.map((row) => [row.category_id, row]));

  const groupOrder = new Map<string, number>();
  for (const row of rows) {
    if (row.group_id !== null) groupOrder.set(row.group_id, row.group_sort_order ?? 0);
  }

  const orderOf = (node: CompositionNode): number =>
    node.level === 'group'
      ? (groupOrder.get(node.id) ?? 0)
      : (byId.get(node.id)?.sort_order ?? 0);

  const compare = (left: CompositionNode, right: CompositionNode): number =>
    orderOf(left) - orderOf(right) || left.name.localeCompare(right.name);

  const colored = (node: CompositionNode, fallback: string): AllocationNode => ({
    ...node,
    color_token: byId.get(node.id)?.color_token ?? fallback,
    children: [],
  });

  return {
    ...composition,
    nodes: [...composition.nodes].sort(compare).map((node): AllocationNode => {
      const children = [...node.children]
        .sort(compare)
        .map((child) => colored(child, FALLBACK_TOKEN));

      return {
        ...node,
        color_token:
          node.level === 'group'
            ? (children[0]?.color_token ?? FALLBACK_TOKEN)
            : (byId.get(node.id)?.color_token ?? FALLBACK_TOKEN),
        children,
      };
    }),
  };
};

export const getAllocation = (deps: GetAllocationDeps) =>
  either(async function* (input: GetAllocationInput) {
    const onDate = input.on_date ?? deps.clock.today();

    const snapshot = yield* await deps.allocation.snapshot({
      portfolio_id: input.portfolio_id,
      on_date: onDate,
    });

    const portfolio = snapshot.portfolio;
    if (portfolio === null) {
      return yield* failure(
        new NotFoundError(`Carteira ${input.portfolio_id} não encontrada`),
      );
    }

    const declared = new Map(
      snapshot.targets.map((target) => [target.category_id, target.target_pct]),
    );

    // O banco exige alvo acima de zero: qualquer linha é estratégia declarada.
    const strategyDefined = snapshot.targets.length > 0;

    /**
     * Quem tem alvo: toda categoria do cadastro, com a linha declarada ou zero.
     * Ativo sem categoria fica de fora — não há categoria onde declarar alvo —,
     * e só entra no total.
     */
    const targetOf = (row: AllocationCategoryRow): string | null =>
      !strategyDefined || row.category_id === NO_CATEGORY
        ? null
        : (declared.get(row.category_id) ?? '0.00');

    const targets = snapshot.categories.flatMap((row) => {
      const target = targetOf(row);
      return target === null ? [] : [{ category_id: row.category_id, target_pct: target }];
    });

    const composition = composeAllocation(snapshot.categories.map(toLine), targets, {
      tolerance_pp: TOLERANCE_PP,
    });

    const colors = new Map(
      snapshot.categories.map((row) => [row.category_id, row] as const),
    );

    const contribution: AllocationContribution | null =
      input.contribution === undefined
        ? null
        : (() => {
            const plan = planContribution(
              snapshot.categories.map((row) => ({
                category_id: row.category_id,
                value: row.value,
                target_pct: targetOf(row),
              })),
              input.contribution,
            );

            return {
              ...plan,
              shares: plan.shares.map((share) => ({
                category_id: share.category_id,
                name: colors.get(share.category_id)?.category_name ?? share.category_id,
                color_token: colors.get(share.category_id)?.color_token ?? FALLBACK_TOKEN,
                amount: share.amount,
                deviation_after_pp: share.deviation_after_pp,
              })),
            };
          })();

    const result: AllocationResult = {
      reference_date: snapshot.reference_date,
      portfolio: {
        id: portfolio.portfolio_id,
        name: portfolio.name,
        recalc_status: portfolio.recalc_status,
      },
      rules: {
        tolerance_pp: TOLERANCE_PP,
        reviewed_on: portfolio.reviewed_on,
        benchmark: describeBenchmark(portfolio.benchmark),
      },
      strategy_defined: strategyDefined,
      composition: arrange(composition, snapshot.categories),
      contribution,
    };

    return result;
  });
