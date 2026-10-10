import {
  amountsFor,
  applyLedger,
  cashBalance,
  costBasisByAsset,
  deviationPp,
  sumValues,
  weightPct,
} from '@patrimonio/calc';
import type { LedgerEntry } from '@patrimonio/calc';
import { dedupeKey, minDateOnly } from '@patrimonio/domain';
import type {
  DateOnly,
  OutboxEventDraft,
  PayoutKind,
  TransactionKind,
} from '@patrimonio/domain';

/**
 * O plano é função pura: recebe o contexto já carregado e devolve o efeito mais
 * os eventos. Não faz I/O, não chama `new Date()` e não decide onde os dados
 * moram — é o que permite rodar o mesmo plano em modo preview e em modo
 * gravação e comparar campo a campo.
 */
export type PlanAsset = {
  readonly id: string;
  readonly ticker: string;
  readonly category_id: string | null;
  /** Primeiro lançamento de um ativo novo pede a carga de histórico de preço. */
  readonly is_new: boolean;
};

export type PlanContext = {
  readonly portfolio_id: string;
  readonly asset: PlanAsset | null;
  readonly institution_id: string;
  /** Lançamentos do ativo nesta carteira: a sequência do preço médio. */
  readonly asset_entries: readonly LedgerEntry[];
  /** Lançamentos da carteira nesta instituição: o caixa sai daqui. */
  readonly institution_entries: readonly LedgerEntry[];
  /** O livro inteiro da carteira: o peso de cada posição sai daqui. */
  readonly portfolio_entries: readonly (LedgerEntry & {
    readonly asset_id: string | null;
  })[];
  /** Categoria de cada ativo da carteira, para a alocação por classe. */
  readonly category_by_asset: ReadonlyMap<string, string | null>;
  readonly targets: ReadonlyMap<string, string>;
  readonly category_name: string | null;
  /** O lançamento que está sendo substituído, numa edição. */
  readonly replacing?: LedgerEntry | undefined;
  readonly origin_request_id?: string | undefined;
};

export type TransactionDraft = {
  readonly id?: string | undefined;
  readonly kind: TransactionKind;
  readonly trade_date: DateOnly;
  readonly settlement_date: DateOnly;
  readonly quantity: string;
  readonly unit_price: string;
  readonly fees: string;
  readonly tax_withheld?: string | undefined;
  readonly payout_kind?: PayoutKind | undefined;
  readonly record_date?: DateOnly | undefined;
  readonly event_ratio_from?: string | undefined;
  readonly event_ratio_to?: string | undefined;
  readonly note?: string | undefined;
};

export type BeforeAfter = {
  readonly before: string;
  readonly after: string;
};

export type AllocationPreview = {
  readonly category_id: string;
  readonly category_name: string | null;
  readonly current_pct: BeforeAfter;
  readonly target_pct: string | null;
  readonly deviation_pp: BeforeAfter | null;
};

/**
 * O que a tela mostra antes de salvar. A regra é uma só: estes números são
 * calculados pelo mesmo plano que grava, nunca por uma aproximação própria da
 * tela — se o preview divergir do que fica gravado, a confiança no app acaba ali.
 */
export type TransactionPreview = {
  /** Enquanto não há preço de mercado (E4), o peso é sobre o custo. */
  readonly basis: 'cost';
  readonly total_amount: string;
  readonly net_amount: string;
  readonly position: {
    readonly quantity: BeforeAfter;
    readonly avg_price: BeforeAfter;
    readonly cost_basis: BeforeAfter;
    readonly weight_pct: BeforeAfter;
  };
  readonly cash: BeforeAfter;
  readonly portfolio_cost_basis: BeforeAfter;
  readonly allocation: AllocationPreview | null;
  /** Só em venda: o resultado realizado daquela operação. */
  readonly realized_result: string | null;
  /** Venda acima da posição disponível. O caso de uso recusa. */
  readonly oversold: boolean;
};

export type TransactionPlan = {
  readonly amounts: { readonly gross_amount: string; readonly net_amount: string };
  readonly events: readonly OutboxEventDraft[];
  readonly preview: TransactionPreview;
};

const asEntry = (draft: TransactionDraft, netAmount: string): LedgerEntry => ({
  ...(draft.id === undefined ? {} : { id: draft.id }),
  kind: draft.kind,
  trade_date: draft.trade_date,
  quantity: draft.quantity,
  unit_price: draft.unit_price,
  fees: draft.fees,
  net_amount: netAmount,
  ...(draft.payout_kind === undefined ? {} : { payout_kind: draft.payout_kind }),
  ...(draft.event_ratio_from === undefined
    ? {}
    : { event_ratio_from: draft.event_ratio_from }),
  ...(draft.event_ratio_to === undefined ? {} : { event_ratio_to: draft.event_ratio_to }),
});

const without = (
  entries: readonly LedgerEntry[],
  replacing: LedgerEntry | undefined,
): readonly LedgerEntry[] =>
  replacing === undefined || replacing.id === undefined
    ? entries
    : entries.filter((entry) => entry.id !== replacing.id);

const costByCategory = (
  costs: ReadonlyMap<string, string>,
  categoryByAsset: ReadonlyMap<string, string | null>,
  categoryId: string,
): string => {
  const values: string[] = [];

  for (const [assetId, cost] of costs) {
    if (categoryByAsset.get(assetId) === categoryId) values.push(cost);
  }

  return sumValues(values);
};

/**
 * O efeito de um lançamento, antes e depois. Numa edição, o lançamento antigo
 * sai da sequência e o novo entra — é por isso que o "antes" de uma edição não
 * é a posição de ontem, e sim a posição sem aquela linha.
 */
export const planTransaction = (
  context: PlanContext,
  draft: TransactionDraft,
): TransactionPlan => {
  const amounts = amountsFor({
    kind: draft.kind,
    quantity: draft.quantity,
    unit_price: draft.unit_price,
    fees: draft.fees,
    tax_withheld: draft.tax_withheld,
  });

  const entry = asEntry(draft, amounts.net_amount);

  const assetBefore = without(context.asset_entries, context.replacing);
  const assetAfter = [...assetBefore, entry];

  const before = applyLedger(assetBefore);
  const after = applyLedger(assetAfter);

  const cashBefore = cashBalance(without(context.institution_entries, context.replacing));
  const cashAfter = cashBalance([
    ...without(context.institution_entries, context.replacing),
    entry,
  ]);

  const assetId = context.asset?.id ?? null;
  const portfolioBefore = context.portfolio_entries.filter(
    (candidate) =>
      context.replacing?.id === undefined || candidate.id !== context.replacing.id,
  );
  const portfolioAfter =
    assetId === null
      ? portfolioBefore
      : [...portfolioBefore, { ...entry, asset_id: assetId }];

  const costsBefore = costBasisByAsset(portfolioBefore);
  const costsAfter = costBasisByAsset(portfolioAfter);

  const totalBefore = sumValues(costsBefore.values());
  const totalAfter = sumValues(costsAfter.values());

  const categoryId = context.asset?.category_id ?? null;

  const allocation: AllocationPreview | null =
    categoryId === null
      ? null
      : (() => {
          const categoryByAssetAfter = new Map(context.category_by_asset);
          if (assetId !== null) categoryByAssetAfter.set(assetId, categoryId);

          const currentBefore = weightPct(
            costByCategory(costsBefore, context.category_by_asset, categoryId),
            totalBefore,
          );
          const currentAfter = weightPct(
            costByCategory(costsAfter, categoryByAssetAfter, categoryId),
            totalAfter,
          );
          const target = context.targets.get(categoryId) ?? null;

          return {
            category_id: categoryId,
            category_name: context.category_name,
            current_pct: { before: currentBefore, after: currentAfter },
            target_pct: target,
            // Categoria sem alvo mostra composição real e desvio vazio, em vez
            // de um desvio contra zero que não quer dizer nada.
            deviation_pp:
              target === null
                ? null
                : {
                    before: deviationPp(currentBefore, target),
                    after: deviationPp(currentAfter, target),
                  },
          };
        })();

  const realized = after.realized.find((sale) => sale.entry_id === (draft.id ?? null));

  const preview: TransactionPreview = {
    basis: 'cost',
    total_amount: amounts.gross_amount,
    net_amount: amounts.net_amount,
    position: {
      quantity: { before: before.position.quantity, after: after.position.quantity },
      avg_price: { before: before.position.avg_price, after: after.position.avg_price },
      cost_basis: {
        before: before.position.cost_basis,
        after: after.position.cost_basis,
      },
      weight_pct: {
        before: weightPct(
          assetId === null ? '0' : (costsBefore.get(assetId) ?? '0'),
          totalBefore,
        ),
        after: weightPct(
          assetId === null ? '0' : (costsAfter.get(assetId) ?? '0'),
          totalAfter,
        ),
      },
    },
    cash: { before: cashBefore, after: cashAfter },
    portfolio_cost_basis: { before: totalBefore, after: totalAfter },
    allocation,
    realized_result:
      draft.kind === 'sell'
        ? (realized?.result ?? after.realized[after.realized.length - 1]?.result ?? null)
        : null,
    oversold: after.oversold && !before.oversold,
  };

  return { amounts, events: planEvents(context, draft), preview };
};

/**
 * Editar um lançamento de 2015 reescreve dez anos de projeção, e criar um de
 * hoje reescreve só hoje: o `from_date` é a data mais antiga tocada pela
 * operação. A chave de coalescência não carrega data, então cinco lançamentos
 * seguidos na mesma carteira viram um recálculo só.
 */
export const planEvents = (
  context: PlanContext,
  draft: TransactionDraft,
): readonly OutboxEventDraft[] => {
  const fromDate =
    context.replacing === undefined
      ? draft.trade_date
      : minDateOnly(draft.trade_date, context.replacing.trade_date);

  const origin =
    context.origin_request_id === undefined
      ? {}
      : { origin_request_id: context.origin_request_id };

  const events: OutboxEventDraft[] = [
    {
      stage: 'recalc',
      dedupe_key: dedupeKey.recalc(context.portfolio_id),
      payload: { portfolio_id: context.portfolio_id, from_date: fromDate },
      ...origin,
    },
  ];

  // Primeiro lançamento de um ticker novo: o preço precisa existir desde a data
  // da compra, e sem isso o patrimônio daquele período nasce errado.
  if (context.asset !== null && context.asset.is_new) {
    events.push({
      stage: 'market',
      dedupe_key: dedupeKey.backfill(context.asset.id),
      payload: { reference_date: fromDate, asset_id: context.asset.id },
      ...origin,
    });
  }

  return events;
};

export type DeletionPreview = {
  readonly basis: 'cost';
  readonly position: {
    readonly quantity: BeforeAfter;
    readonly avg_price: BeforeAfter;
    readonly cost_basis: BeforeAfter;
  };
  readonly cash: BeforeAfter;
  readonly portfolio_cost_basis: BeforeAfter;
  /** O resultado realizado do ativo, que uma venda excluída devolve. */
  readonly realized_result: BeforeAfter;
};

/**
 * O que a exclusão muda, antes de confirmar. O "antes" é o estado de hoje e o
 * "depois" é o estado sem aquela linha — os lançamentos posteriores continuam
 * valendo, e é justamente por isso que excluir uma compra antiga mexe em tudo
 * o que veio depois dela.
 */
export const planDeletion = (
  context: PlanContext,
  removed: readonly LedgerEntry[],
): DeletionPreview => {
  const removedIds = new Set(
    removed.map((entry) => entry.id).filter((id): id is string => id !== undefined),
  );

  const keep = <T extends LedgerEntry>(entries: readonly T[]): T[] =>
    entries.filter((entry) => entry.id === undefined || !removedIds.has(entry.id));

  const before = applyLedger(context.asset_entries);
  const after = applyLedger(keep(context.asset_entries));

  const costsBefore = costBasisByAsset(context.portfolio_entries);
  const costsAfter = costBasisByAsset(keep(context.portfolio_entries));

  return {
    basis: 'cost',
    position: {
      quantity: { before: before.position.quantity, after: after.position.quantity },
      avg_price: { before: before.position.avg_price, after: after.position.avg_price },
      cost_basis: {
        before: before.position.cost_basis,
        after: after.position.cost_basis,
      },
    },
    cash: {
      before: cashBalance(context.institution_entries),
      after: cashBalance(keep(context.institution_entries)),
    },
    portfolio_cost_basis: {
      before: sumValues(costsBefore.values()),
      after: sumValues(costsAfter.values()),
    },
    realized_result: { before: before.realized_total, after: after.realized_total },
  };
};
