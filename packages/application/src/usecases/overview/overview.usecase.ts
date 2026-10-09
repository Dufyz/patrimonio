import {
  buildQuotaSeries,
  composeAllocation,
  growthSeries,
  periodFlows,
  returnPct,
  sumValues,
  valueChange,
  weighByValue,
  weightPct,
} from '@patrimonio/calc';
import type {
  AllocationLine,
  Composition,
  CompositionNode,
  GrowthPoint,
} from '@patrimonio/calc';
import { alertGroupFor } from '@patrimonio/domain';
import type {
  AlertGroup,
  AlertInstance,
  ComputedPriceKind,
  DateOnly,
  RecalcStatus,
} from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type {
  OverviewDayRow,
  OverviewPortfolioRow,
  OverviewSnapshot,
} from '../../interfaces/overview.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

/**
 * A tela de abertura, que responde duas perguntas nessa ordem: **quanto eu
 * tenho hoje** e **o que precisa de mim**.
 *
 * A ordem é a tela inteira. O patrimônio e a variação vêm primeiro porque é a
 * pergunta que faz a pessoa abrir o app; o que exige ação vem por último
 * porque é o que a faz fechar — e some da tela quando não há nada pendente, em
 * vez de mostrar um painel vazio dizendo que está tudo bem.
 *
 * ## O que esta resposta não faz
 *
 * Ela não executa regra de alerta. As regras rodam no fechamento do dia e
 * gravam o resultado (`reconcileAlerts`); aqui elas só são lidas. Rodar regra
 * na abertura da tela deixaria o painel lento e, pior, faria o mesmo alerta
 * aparecer e sumir conforme a hora em que a tela foi aberta — e adiar e
 * ignorar deixariam de significar alguma coisa.
 *
 * ## Por que a cota consolidada é calculada aqui
 *
 * `portfolio_daily.quota_value` existe por carteira, e somar cota de carteiras
 * diferentes não significa nada. Para "todas as carteiras" a cota é construída
 * sobre a janela pedida, partindo do fechamento anterior a ela: o retorno da
 * janela é uma razão entre duas cotas, então a semente não muda a resposta. A
 * resposta declara qual dos dois métodos usou, porque a tela precisa poder
 * dizê-lo.
 */
export type OverviewChange = { readonly amount: string; readonly ratio: string | null };

export type OverviewScope = {
  readonly portfolio_id: string | null;
  readonly name: string;
  readonly purpose: string | null;
  readonly tolerance_pp: string;
  readonly recalc_status: RecalcStatus;
  readonly inception: DateOnly | null;
};

export type OverviewTotals = {
  readonly value: string | null;
  readonly day: OverviewChange | null;
  readonly month: OverviewChange | null;
  /** Quanto o escopo é do patrimônio inteiro. Nulo no consolidado. */
  readonly weight_pct: string | null;
};

export type OverviewPeriod = {
  readonly from: DateOnly;
  readonly to: DateOnly;
  readonly return_pct: string | null;
  /** `portfolio_quota` é a cota gravada; `window_quota`, a consolidada da janela. */
  readonly return_method: 'portfolio_quota' | 'window_quota' | 'unavailable';
  readonly contributions: string;
  readonly income: string;
  readonly payouts: string;
};

export type OverviewTopPosition = {
  readonly asset_id: string;
  readonly ticker: string;
  readonly name: string;
  readonly b3_type: string | null;
  readonly color_token: string | null;
  readonly value: string;
  readonly weight_pct: string;
  readonly price_source_kind: ComputedPriceKind;
};

export type OverviewPortfolioShare = {
  readonly portfolio_id: string;
  readonly name: string;
  readonly value: string;
  readonly weight_pct: string;
};

export type OverviewAttentionItem = {
  readonly rule_kind: string;
  readonly subject_id: string;
  readonly portfolio_id: string | null;
  readonly payload: Record<string, unknown>;
  readonly first_seen_at: string;
};

export type OverviewAttentionGroup = {
  readonly group: AlertGroup;
  readonly count: number;
  readonly items: readonly OverviewAttentionItem[];
};

export type OverviewAttention = {
  readonly total: number;
  /** O mesmo painel conta as duas leituras: esta carteira e todas. */
  readonly total_all_portfolios: number;
  readonly groups: readonly OverviewAttentionGroup[];
};

/**
 * A composição com a cor de cada linha. `composeAllocation` não conhece
 * design system, e a tela não pode escolher cor por conta própria: Ações
 * precisa ter a mesma cor na barra, na tabela e no gráfico, e quem garante
 * isso é `category.color_token`, que viaja junto da linha.
 */
export type ColoredNode = Omit<CompositionNode, 'children'> & {
  readonly color_token: string;
  readonly children: readonly ColoredNode[];
};

export type ColoredComposition = Omit<Composition, 'nodes'> & {
  readonly nodes: readonly ColoredNode[];
};

export type OverviewResult = {
  readonly reference_date: DateOnly | null;
  readonly scope: OverviewScope;
  readonly totals: OverviewTotals;
  readonly period: OverviewPeriod;
  readonly series: readonly GrowthPoint[];
  readonly composition: ColoredComposition;
  readonly by_portfolio: readonly OverviewPortfolioShare[];
  readonly top_positions: {
    readonly total_count: number;
    readonly rows: readonly OverviewTopPosition[];
  };
  readonly attention: OverviewAttention;
};

export type OverviewInput = {
  readonly portfolio_id?: string | null | undefined;
  readonly on_date?: DateOnly | undefined;
  readonly from?: DateOnly | undefined;
  readonly to?: DateOnly | undefined;
};

export type OverviewDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** Quantas posições a tabela curta mostra antes do "todas". */
  readonly topPositions?: number | undefined;
};

const DEFAULT_TOP_POSITIONS = 6;
const DEFAULT_WINDOW_MONTHS = 12;
const ALL_PORTFOLIOS_NAME = 'Todas as carteiras';

/** Doze meses para trás, pela data civil: a janela padrão da prancha. */
const twelveMonthsBefore = (date: DateOnly): DateOnly => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const shifted = new Date(Date.UTC(year, month - 1 - DEFAULT_WINDOW_MONTHS, day));

  return shifted.toISOString().slice(0, 10) as DateOnly;
};

const lastDayOf = (days: readonly OverviewDayRow[]): OverviewDayRow | null =>
  days.at(-1) ?? null;

/**
 * O retorno da janela. Com uma carteira, as duas cotas gravadas bastam. Sem
 * ela, a cota é reconstruída sobre a janela — e quando não há nem fechamento
 * anterior nem dois dias de série, a resposta é nula e a tela mostra traço.
 */
const windowReturn = (
  snapshot: OverviewSnapshot,
  scoped: boolean,
): Pick<OverviewPeriod, 'return_pct' | 'return_method'> => {
  const last = lastDayOf(snapshot.days);
  if (last === null) return { return_pct: null, return_method: 'unavailable' };

  /**
   * A base é o fechamento anterior à janela. Quando ele não existe — a janela
   * começa onde a carteira começou —, a base é o primeiro fechamento dela, e o
   * retorno é o da história inteira. Devolver nulo aí diria "não dá para
   * medir" sobre a única janela que dá.
   */
  const first = snapshot.days[0] ?? null;
  const fromInception = snapshot.anchors.window_base === null;
  const base = snapshot.anchors.window_base ?? first;

  if (base === null) return { return_pct: null, return_method: 'unavailable' };

  if (scoped) {
    if (base.quota_value === null || last.quota_value === null) {
      return { return_pct: null, return_method: 'unavailable' };
    }

    return {
      return_pct: returnPct(base.quota_value, last.quota_value),
      return_method: 'portfolio_quota',
    };
  }

  // A semente é o fechamento anterior à janela, com cota em 1: o retorno é uma
  // razão entre cotas, então o valor da semente não entra na resposta.
  const series = buildQuotaSeries(fromInception ? snapshot.days.slice(1) : snapshot.days, {
    previous: {
      position_date: base.position_date,
      total_value: base.total_value,
      quota_value: '1',
      quota_count: base.total_value,
      cumulative_contributions: base.cumulative_contributions,
    },
  });

  const end = series.at(-1);
  if (end === undefined) return { return_pct: null, return_method: 'unavailable' };

  return { return_pct: returnPct('1', end.quota_value), return_method: 'window_quota' };
};

const FALLBACK_TOKEN = 'class.outros';

/**
 * O grupo herda a cor do filho de maior valor: um grupo não tem token próprio,
 * e a alternativa — cinza para todo grupo — apagaria a leitura de cor
 * justamente na linha que a tela mostra fechada.
 */
const colorize = (
  composition: Composition,
  tokens: ReadonlyMap<string, string>,
): ColoredComposition => ({
  ...composition,
  nodes: composition.nodes.map((node): ColoredNode => {
    const children = node.children.map(
      (child): ColoredNode => ({
        ...child,
        color_token: tokens.get(child.id) ?? FALLBACK_TOKEN,
        children: [],
      }),
    );

    return {
      ...node,
      children,
      color_token:
        tokens.get(node.id) ?? children[0]?.color_token ?? FALLBACK_TOKEN,
    };
  }),
});

const allocationLines = (snapshot: OverviewSnapshot): readonly AllocationLine[] =>
  snapshot.categories.map((row) => ({
    category_id: row.category_id,
    category_name: row.category_name,
    group_id: row.group_id,
    group_name: row.group_name,
    value: row.value,
  }));

const scopeOf = (
  snapshot: OverviewSnapshot,
  portfolioId: string | null,
  portfolio: OverviewPortfolioRow | null,
): OverviewScope =>
  portfolio === null
    ? {
        portfolio_id: null,
        name: ALL_PORTFOLIOS_NAME,
        purpose: null,
        // Sem carteira não há tolerância declarada: o desvio aparece sem a
        // marca de "fora da faixa", que é uma decisão de cada carteira.
        tolerance_pp: '0',
        recalc_status: snapshot.portfolios.some(
          (row) => row.recalc_status === 'running' || row.recalc_status === 'queued',
        )
          ? 'running'
          : 'idle',
        inception: snapshot.inception,
      }
    : {
        portfolio_id: portfolioId,
        name: portfolio.name,
        purpose: portfolio.purpose,
        tolerance_pp: portfolio.tolerance_pp,
        recalc_status: portfolio.recalc_status,
        inception: snapshot.inception,
      };

const attentionOf = (
  alerts: readonly AlertInstance[],
  portfolioId: string | null,
): OverviewAttention => {
  const inScope =
    portfolioId === null
      ? alerts
      : alerts.filter(
          (alert) => alert.portfolio_id === portfolioId || alert.portfolio_id === null,
        );

  const groups = (['corrigir', 'decidir', 'acompanhar'] as const)
    .map((group): OverviewAttentionGroup => {
      const items = inScope
        .filter((alert) => alertGroupFor(alert.rule_kind) === group)
        .map((alert) => ({
          rule_kind: alert.rule_kind,
          subject_id: alert.subject_id,
          portfolio_id: alert.portfolio_id,
          payload: alert.payload,
          first_seen_at: alert.first_seen_at,
        }));

      return { group, count: items.length, items };
    })
    // Nenhum bloco aparece vazio: grupo sem item sai da tela.
    .filter((group) => group.count > 0);

  return {
    total: inScope.length,
    total_all_portfolios: alerts.length,
    groups,
  };
};

export const getOverview = (deps: OverviewDeps) =>
  either(async function* (input: OverviewInput) {
    const today = deps.clock.today();
    const onDate = input.on_date ?? today;
    const to = input.to ?? onDate;
    const from = input.from ?? twelveMonthsBefore(to);
    const portfolioId = input.portfolio_id ?? null;
    const limit = deps.topPositions ?? DEFAULT_TOP_POSITIONS;

    return yield* await deps.unitOfWork.run<AppError, OverviewResult>(
      async (repositories) => {
        const read = await repositories.overview.snapshot({
          portfolio_id: portfolioId,
          on_date: onDate,
          from,
          to,
        });
        if (read.isFailure()) return read;

        const snapshot = read.value;
        const portfolio =
          portfolioId === null
            ? null
            : (snapshot.portfolios.find((row) => row.portfolio_id === portfolioId) ??
              null);

        if (portfolioId !== null && portfolio === null) {
          return failure(new NotFoundError(`Carteira ${portfolioId} não encontrada`));
        }

        // A segunda consulta da rota. O painel conta as duas leituras — esta
        // carteira e todas —, então o escopo é aplicado depois de ler.
        const alerts = await repositories.alerts.listActive({ on_date: onDate });
        if (alerts.isFailure()) return alerts;

        const referenceDate = snapshot.reference_date;

        // O patrimônio inteiro, somado em decimal: é a base do peso do escopo
        // e da distribuição por carteira.
        const everything = sumValues(
          snapshot.portfolios.map((row) => row.total_value ?? '0'),
        );

        /**
         * O número principal é o do **fechamento**, não o do fim da janela:
         * trocar o período para ver 2024 no gráfico não pode mudar a resposta
         * de "quanto eu tenho hoje", que é a primeira pergunta da tela.
         */
        const total =
          referenceDate === null
            ? null
            : portfolio === null
              ? everything
              : portfolio.total_value;

        /**
         * O peso das posições é medido contra a soma delas, que é a mesma base
         * da composição por categoria. Usar o total do fechamento faria os
         * dois painéis da tela discordarem no dia em que a projeção de uma
         * carteira ficasse para trás — e dois pesos diferentes para o mesmo
         * ativo na mesma tela é pior do que um peso velho.
         */
        const held = sumValues(snapshot.positions.map((row) => row.value));

        const positions = weighByValue(
          snapshot.positions.map((row) => ({
            id: row.asset_id,
            label: row.ticker,
            value: row.value,
            asset_id: row.asset_id,
            ticker: row.ticker,
            name: row.name,
            b3_type: row.b3_type,
            color_token: row.color_token,
            price_source_kind: row.price_source_kind,
          })),
          held,
        );

        const shares = weighByValue(
          snapshot.portfolios
            .filter((row) => row.total_value !== null)
            .map((row) => ({
              id: row.portfolio_id,
              label: row.name,
              value: row.total_value ?? '0',
              portfolio_id: row.portfolio_id,
              name: row.name,
            })),
          everything,
        );

        const flows = periodFlows(snapshot.days);

        return success({
          reference_date: referenceDate,
          scope: scopeOf(snapshot, portfolioId, portfolio),
          totals: {
            value: total,
            day: valueChange(snapshot.anchors.previous_day?.total_value ?? null, total),
            month: valueChange(snapshot.anchors.month_base?.total_value ?? null, total),
            weight_pct:
              portfolio === null || total === null ? null : weightPct(total, everything),
          },
          period: {
            from,
            to,
            ...windowReturn(snapshot, portfolioId !== null),
            contributions: flows.contributions,
            income: flows.income,
            payouts: flows.payouts,
          },
          series: growthSeries(snapshot.days),
          composition: colorize(
            composeAllocation(allocationLines(snapshot), snapshot.targets, {
              tolerance_pp: portfolio?.tolerance_pp ?? '0',
            }),
            new Map(
              snapshot.categories.map((row) => [row.category_id, row.color_token]),
            ),
          ),
          by_portfolio: shares.map((row) => ({
            portfolio_id: row.portfolio_id,
            name: row.name,
            value: row.value,
            weight_pct: row.weight_pct,
          })),
          top_positions: {
            total_count: positions.length,
            rows: positions.slice(0, limit).map((row) => ({
              asset_id: row.asset_id,
              ticker: row.ticker,
              name: row.name,
              b3_type: row.b3_type,
              color_token: row.color_token,
              value: row.value,
              weight_pct: row.weight_pct,
              price_source_kind: row.price_source_kind,
            })),
          },
          attention: attentionOf(alerts.value, portfolioId),
        });
      },
    );
  });
