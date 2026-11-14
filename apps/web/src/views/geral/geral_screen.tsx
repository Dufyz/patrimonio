import type { GoalsOverviewResource, OverviewResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { fetchBook } from '../../api/book.js';
import { fetchForecast } from '../../api/forecast.js';
import { fetchCardsOverview } from '../../api/cards_overview.js';
import { fetchGoalsOverview } from '../../api/goals.js';
import { fetchOverview } from '../../api/overview.js';
import { HomeScopeControl } from '../../components/home_scope_control.js';
import { useShortcuts } from '../../components/shortcuts.js';
import { usePortfolios } from '../../components/portfolios_provider.js';
import {
  Money,
  MoneyChange,
  PercentChange,
  PrincipalMoney,
} from '../../components/number.js';
import { KeepPrevious } from '../../components/pending.js';
import { Label, Panel } from '../../components/primitives.js';
import { SeriesChart } from '../../components/series_chart.js';
import { SkeletonChart, SkeletonRegion } from '../../components/skeleton.js';
import { Amount } from '../../finance/components/amount.js';
import { EntryDialog } from '../../finance/components/entry_dialog.js';
import { FillRow, FinTable, Th, THead } from '../../finance/components/fin_table.js';
import {
  ContasPanel,
  FaturasAbertasPanel,
  ProximosLancamentosPanel,
} from '../../finance/components/overview_panels.js';
import { useFinancePeriod } from '../../finance/components/period_provider.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { PanelBoundary, PanelError } from '../../finance/components/states.js';
import { accountsOverview } from '../../finance/domain/accounts.js';
import { accountsTotal } from '../../finance/domain/cash_flow.js';
import { emptyEntryDraft } from '../../finance/domain/entry_ops.js';
import type { FinanceData } from '../../finance/domain/types.js';
import { endOfMonth } from '../../finance/lib/dates.js';
import type { IsoDate } from '../../finance/lib/dates.js';
import {
  allocatePercentTenths,
  formatMonth,
  formatPercentTenths,
} from '../../finance/lib/format.js';
import { decimalToCents } from '../../finance/lib/money.js';
import type { Cents } from '../../finance/lib/money.js';
import { currentMonth } from '../../finance/lib/period.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { useFinanceData, useFinanceStore } from '../../finance/store/finance_store.js';
import { commands } from '../../finance/store/commands.js';
import { DEFAULT_PERIOD, resolvePeriod } from '../../lib/period.js';
import { formatDate, monthLabel, percentAsRatio } from '../../lib/overview.js';
import { routes } from '../../lib/routes.js';
import { ALL_SCOPE, scopeForPortfolioId } from '../../lib/scope.js';
import type { Resource } from '../../lib/use_resource.js';
import { useResource } from '../../lib/use_resource.js';
import { ClassesTable } from '../overview_classes.js';
import { PortfoliosPanel } from '../overview_portfolios.js';
import { GoalPanelBody } from '../overview_goal.js';
import { Evolution } from '../overview.js';

/**
 * GER · A Visão geral de Geral: o patrimônio inteiro, Finanças e todas as
 * carteiras juntos. Cada painel resume uma tela que existe em outra área e
 * leva a ela; nenhum número nasce aqui. O saldo previsto do fim do mês é o da
 * Visão geral de Finanças (`cashOutlook`), e o patrimônio de investimentos é o
 * de Todas as carteiras.
 */

const LINK = 'cursor-pointer text-[0.8125rem] text-accent hover:underline';

const Muted = ({ children }: { readonly children: React.ReactNode }) => (
  <span className="text-ink-3">{children}</span>
);

/** Uma linha de composição: rótulo (com link), sinal e valor. */
const Line = ({
  label,
  to,
  cents,
  sign,
  strong = false,
  indent = false,
  weight,
}: {
  readonly label: string;
  readonly to?: string | undefined;
  readonly cents: Cents | null;
  readonly sign?: '+' | '−' | undefined;
  readonly strong?: boolean;
  /** Linha de detalhe: recuada e em tom suave, abaixo do total que ela compõe. */
  readonly indent?: boolean;
  /** Peso no patrimônio, em décimos de ponto; quando existe, a linha tem a coluna Peso. */
  readonly weight?: number | undefined;
}): React.ReactElement => (
  <tr
    className={`border-t border-line ${strong ? 'bg-panel-2 font-semibold' : ''} ${
      indent ? 'text-ink-2' : ''
    }`}
  >
    <th
      scope="row"
      className={`py-[var(--row-pad)] pr-3 text-left font-[inherit] ${
        indent ? 'pl-7 text-xs' : 'pl-3'
      }`}
    >
      {to === undefined ? (
        label
      ) : (
        <Link to={to} className="cursor-pointer hover:text-accent hover:underline">
          {label}
        </Link>
      )}
    </th>
    <td className="tabular px-3 py-[var(--row-pad)] text-right">
      {cents === null ? (
        <Muted>—</Muted>
      ) : (
        <>
          {sign === undefined ? null : (
            <span aria-hidden="true" className="mr-1 text-ink-3">
              {sign}
            </span>
          )}
          <Amount cents={cents} />
        </>
      )}
    </td>
    {weight === undefined ? null : (
      <td className="tabular px-3 py-[var(--row-pad)] text-right text-ink-3">
        {formatPercentTenths(weight)}
      </td>
    )}
  </tr>
);

/* -------------------------------------------------------------------------- */
/* GER-002 · Patrimônio                                                       */

/**
 * O patrimônio é o que está em contas mais o que está em carteiras. Faturas
 * abertas não entram: o que se deve no cartão depende de datas de fechamento e
 * vencimento, e uma subtração aqui esconderia isso. Elas têm o próprio painel.
 */
export const PatrimonioPanel = ({
  data,
  today,
  overview,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
  /** A leitura de Todas as carteiras; nula enquanto não chega ou se falhou. */
  readonly overview: OverviewResource | null;
}): React.ReactElement => {
  const { slugs } = usePortfolios();
  const inAccounts = useMemo(() => accountsTotal(data, today), [data, today]);
  const accounts = useMemo(
    () =>
      accountsOverview(data, currentMonth(today), today).accounts.filter(
        (row) => row.account.archived !== true,
      ),
    [data, today],
  );

  const investments =
    overview === null
      ? null
      : overview.reference_date === null
        ? 0
        : (decimalToCents(overview.totals.value ?? '0') ?? 0);
  const total = investments === null ? null : inAccounts + investments;
  const wallets = overview === null ? [] : overview.by_portfolio;

  // Os pesos são sobre o patrimônio e somam 100% (RN-64): cada linha de detalhe
  // recebe os seus décimos, e cada total é a soma das linhas dele.
  const tenths = allocatePercentTenths([
    ...accounts.map((row) => Math.max(0, row.balance)),
    ...wallets.map((row) => Math.max(0, decimalToCents(row.value) ?? 0)),
  ]);
  const accountTenths = tenths.slice(0, accounts.length);
  const walletTenths = tenths.slice(accounts.length);
  const sumOf = (values: readonly number[]): number =>
    values.reduce((acc, value) => acc + value, 0);
  const month = overview?.totals.month ?? null;

  return (
    <Panel
      title="Patrimônio"
      action={<span className="text-xs text-ink-3">em {formatDate(today)}</span>}
      className="flex flex-col"
    >
      <div className="px-4 pt-4 pb-3">
        <p className="tabular text-[1.75rem] leading-9 font-semibold">
          {total === null ? <Muted>—</Muted> : <Amount cents={total} />}
        </p>
        <p className="text-xs text-ink-3">
          em contas + em carteiras
          {month === null ? null : (
            <>
              {' · '}
              <MoneyChange value={month.amount} />
              {month.ratio === null ? null : (
                <>
                  {' ('}
                  <PercentChange value={percentAsRatio(month.ratio)} decimals={2} />
                  {')'}
                </>
              )}{' '}
              em carteiras no mês
            </>
          )}
        </p>
      </div>
      <FinTable caption="Composição do patrimônio" fill>
        <THead>
          <Th>Composição</Th>
          <Th align="right">Valor</Th>
          <Th align="right">Peso</Th>
        </THead>
        <tbody>
          <Line
            label="Em contas"
            to={financeRoutes.accounts()}
            cents={inAccounts}
            weight={sumOf(accountTenths)}
          />
          {accounts.map((row, index) => (
            <Line
              key={row.account.id}
              indent
              label={row.account.name}
              to={financeRoutes.account(row.account.id)}
              cents={row.balance}
              weight={accountTenths[index] ?? 0}
            />
          ))}
          <Line
            label="Em carteiras"
            to={routes.home('investimentos', ALL_SCOPE)}
            cents={investments}
            weight={investments === null ? undefined : sumOf(walletTenths)}
          />
          {wallets.map((row, index) => {
            const slug = slugs.get(row.portfolio_id);
            return (
              <Line
                key={row.portfolio_id}
                indent
                label={row.name}
                to={
                  slug === undefined
                    ? routes.home('investimentos', ALL_SCOPE)
                    : routes.home('investimentos', slug)
                }
                cents={decimalToCents(row.value) ?? 0}
                weight={walletTenths[index] ?? 0}
              />
            );
          })}
          <FillRow colSpan={3} />
          <Line
            label="Patrimônio"
            cents={total}
            strong
            weight={total === null ? undefined : 1000}
          />
        </tbody>
      </FinTable>
      <LivreAposFaturas />
    </Panel>
  );
};

/**
 * VGR-02 · Quanto está livre depois de pagar as faturas (RN-U3). Faturas não
 * descontam do Patrimônio; esta linha é a conta de caixa. Quando o livre é zero
 * por falta, o painel diz quanto falta. Lido do servidor: nenhuma conta aqui.
 */
const LivreAposFaturas = (): React.ReactElement | null => {
  const cards = useResource((signal) => fetchCardsOverview(signal), []);
  if (cards.state.kind !== 'ready') return null;

  const { livre, falta } = cards.state.value.wealth;
  const lacking = decimalToCents(falta) ?? 0;

  return (
    <div className="flex flex-col gap-0.5 border-t border-line px-4 py-3 text-[0.8125rem]">
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          to={financeRoutes.cards()}
          className="font-semibold hover:text-accent hover:underline"
        >
          Livre após faturas
        </Link>
        <span className="tabular font-semibold">
          <Amount cents={decimalToCents(livre) ?? 0} />
        </span>
      </p>
      {lacking > 0 ? (
        <p role="status" className="text-xs text-negative">
          faltam <Amount cents={lacking} /> para pagar as faturas
        </p>
      ) : null}
      <p className="text-xs text-ink-3">Faturas não descontam do Patrimônio.</p>
    </div>
  );
};

/**
 * VGR-03 · A cascata do mês, lida do livro do servidor (RN-U1): Receitas −
 * Despesas − Aportes = Saldo do mês, em Lançado e Previsto. Provento e resgate
 * não entram. Cada valor leva aos Lançamentos já filtrados.
 */
const CascataDoMes = ({ month }: { readonly month: string }): React.ReactElement => {
  const book = useResource((signal) => fetchBook({ month, limit: 1 }, signal), [month]);
  const state = book.state;
  if (state.kind === 'loading') {
    return (
      <p className="border-t border-line px-4 py-3 text-xs text-ink-3">
        Carregando a cascata do mês…
      </p>
    );
  }
  if (state.kind !== 'ready') {
    return (
      <PanelError
        title="Não foi possível carregar a cascata do mês"
        onRetry={book.reload}
      />
    );
  }
  const { totals } = state.value;
  const cents = (value: string): Cents => (decimalToCents(value) ?? 0) as Cents;
  const saldoPrevisto =
    cents(totals.previsto.receitas) -
    cents(totals.previsto.despesas) -
    cents(totals.previsto.aportes);
  const link = (tipo: string, situacao: string): string =>
    financeRoutes.entries(`tipo=${tipo}&situacao=${situacao}`);
  const rows = [
    {
      label: 'Receitas',
      tipo: 'RECEITA',
      sign: '+',
      posted: totals.receitas,
      planned: totals.previsto.receitas,
    },
    {
      label: 'Despesas',
      tipo: 'DESPESA',
      sign: '−',
      posted: totals.despesas,
      planned: totals.previsto.despesas,
    },
    {
      label: 'Aportes',
      tipo: 'APORTE',
      sign: '−',
      posted: totals.aportes,
      planned: totals.previsto.aportes,
    },
  ];
  return (
    <div className="border-t border-line">
      <FinTable caption="Cascata do mês">
        <THead>
          <Th>Saldo do mês</Th>
          <Th align="right">Lançado</Th>
          <Th align="right">Previsto</Th>
        </THead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tipo} className="border-t border-line">
              <th
                scope="row"
                className="py-[var(--row-pad)] pl-3 text-left font-[inherit]"
              >
                {row.sign} {row.label}
              </th>
              <td className="tabular py-[var(--row-pad)] pr-3 text-right">
                <Link to={link(row.tipo, 'lancado')} className={LINK}>
                  <Amount cents={cents(row.posted)} />
                </Link>
              </td>
              <td className="tabular py-[var(--row-pad)] pr-3 text-right text-ink-2">
                <Link to={link(row.tipo, 'previsto')} className={LINK}>
                  <Amount cents={cents(row.planned)} />
                </Link>
              </td>
            </tr>
          ))}
          <tr className="border-t border-line bg-panel-2 font-semibold">
            <th scope="row" className="py-[var(--row-pad)] pl-3 text-left font-[inherit]">
              = Saldo do mês
            </th>
            <td className="tabular py-[var(--row-pad)] pr-3 text-right">
              <Amount cents={cents(totals.saldo_do_mes)} />
            </td>
            <td className="tabular py-[var(--row-pad)] pr-3 text-right text-ink-2">
              <Amount cents={saldoPrevisto as Cents} />
            </td>
          </tr>
        </tbody>
      </FinTable>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* GER-004 · Fluxo do mês                                                     */

export const FluxoDoMesPanel = ({
  today,
}: {
  readonly today: IsoDate;
}): React.ReactElement => {
  return (
    <Panel
      title="Fluxo do mês"
      action={
        <span className="flex items-baseline gap-3">
          <span className="text-xs text-ink-3">{formatMonth(today)}</span>
          <Link to={financeRoutes.overview()} className={LINK}>
            Finanças →
          </Link>
        </span>
      }
      className="flex flex-col"
    >
      <CascataDoMes month={today.slice(0, 7)} />
    </Panel>
  );
};

/**
 * VGR-04 · Saldo previsto (RN-U9): Em contas hoje + entradas − saídas − aportes
 * − pagamentos de fatura, ao fim do mês, com a curva dia a dia e o menor saldo.
 * Tudo lido da previsão do servidor, a mesma de Contas (RN-U16).
 */
export const SaldoPrevistoPanel = ({
  today,
}: {
  readonly today: IsoDate;
}): React.ReactElement => {
  const from = `${today.slice(0, 7)}-01`;
  const to = endOfMonth(today);
  const forecast = useResource(
    (signal) => fetchForecast({ from, to }, signal),
    [from, to],
  );
  const state = forecast.state;
  const cents = (value: string): Cents => (decimalToCents(value) ?? 0) as Cents;

  let body: React.ReactElement;
  if (state.kind === 'loading') {
    body = <p className="px-4 py-3 text-xs text-ink-3">Carregando o saldo previsto…</p>;
  } else if (state.kind !== 'ready') {
    body = (
      <PanelError
        title="Não foi possível carregar o saldo previsto"
        onRetry={forecast.reload}
      />
    );
  } else {
    const { parts, series } = state.value;
    const dates = series.points.map((point) => point.date as DateOnly);
    const lastRealized = series.points.reduce(
      (index, point, at) => (point.forecast ? index : at),
      -1,
    );
    const realized = {
      id: 'realizado',
      label: 'Realizado',
      color: 'var(--color-accent)',
      area: true,
      points: series.points.map((point, at) => ({
        date: point.date as DateOnly,
        value: at <= lastRealized ? point.balance : null,
      })),
    };
    const planned = {
      id: 'previsto',
      label: 'Previsto',
      color: 'var(--color-ink-3)',
      dashed: true,
      points: series.points.map((point, at) => ({
        date: point.date as DateOnly,
        value:
          at >= lastRealized && lastRealized >= 0
            ? point.balance
            : point.forecast
              ? point.balance
              : null,
      })),
    };
    const lowest = series.lowest;
    const lowestCents = lowest === null ? 0 : cents(lowest.balance);
    body = (
      <>
        <FinTable caption="Saldo previsto">
          <THead>
            <Th>Até {formatDate(state.value.date as DateOnly)}</Th>
            <Th align="right">Valor</Th>
          </THead>
          <tbody>
            <Line
              label="Em contas hoje"
              to={financeRoutes.accounts()}
              cents={cents(parts.em_contas)}
            />
            <Line label="Entradas previstas" cents={cents(parts.entradas)} sign="+" />
            <Line label="Saídas previstas" cents={cents(parts.saidas)} sign="−" />
            <Line label="Aportes previstos" cents={cents(parts.aportes)} sign="−" />
            <Line
              label="Pagamentos de fatura"
              to={financeRoutes.cards()}
              cents={cents(parts.faturas)}
              sign="−"
            />
            <Line
              label="Saldo previsto ao fim do mês"
              cents={cents(parts.saldo)}
              strong
            />
          </tbody>
        </FinTable>
        <div className="border-t border-line px-4 pt-3 pb-2">
          <SeriesChart
            dates={dates}
            series={[realized, planned]}
            valueFormat="money"
            ariaLabel="Saldo previsto dia a dia"
            height={160}
            xTickLabel={(date) => date.slice(8, 10)}
            tooltipDateLabel={(date) => formatDate(date)}
            markers={
              lowest === null
                ? undefined
                : [
                    {
                      id: 'menor',
                      date: lowest.date as DateOnly,
                      value: lowest.balance,
                      color:
                        lowestCents < 0 ? 'var(--color-negative)' : 'var(--color-ink-2)',
                      label: 'Menor saldo',
                    },
                  ]
            }
            markerLegend="Menor saldo"
          />
        </div>
        {lowest === null ? null : (
          <p
            className={`border-t border-line px-4 py-3 text-[0.8125rem] ${
              lowestCents < 0 ? 'text-negative' : ''
            }`}
          >
            Menor saldo até {formatDate(lowest.date as DateOnly).slice(0, 5)}:{' '}
            <span className="tabular font-semibold">
              <Amount cents={lowestCents as Cents} />
            </span>
          </p>
        )}
      </>
    );
  }

  return (
    <Panel
      title="Saldo previsto"
      action={
        <Link to={financeRoutes.accounts()} className={LINK}>
          Contas →
        </Link>
      }
      className="flex flex-col"
    >
      {body}
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* A tela                                                                     */

export type GeralViewProps = {
  readonly data: FinanceData;
  readonly today: IsoDate;
  readonly overview: Resource<OverviewResource>;
  readonly goals: Resource<GoalsOverviewResource>;
  readonly onNewEntry: () => void;
  /** Depois de lançar um previsto, a tela relê Finanças. */
  readonly onLaunched?: () => void;
};

const InvestmentsLoading = (): React.ReactElement => (
  <SkeletonRegion label="Carregando os investimentos">
    <SkeletonChart />
  </SkeletonRegion>
);

const InvestmentsFailed = ({
  error,
  onRetry,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
}): React.ReactElement => (
  <p
    role="alert"
    className="flex flex-wrap items-center gap-3 p-4 text-[0.8125rem] text-negative"
  >
    <span>Não foi possível carregar os investimentos: {error.message}</span>
    <button
      type="button"
      className="h-control cursor-pointer rounded-control border border-line px-3 text-ink hover:bg-panel-2"
      onClick={onRetry}
    >
      Tentar de novo
    </button>
  </p>
);

/**
 * VGR-05 · O cabeçalho da evolução: o patrimônio das carteiras, a variação do
 * mês da última consolidação e os três totais do período. O valor é o mesmo
 * de Em carteiras e de Posições (RN-U16).
 */
const EvolutionHeader = ({
  overview,
}: {
  readonly overview: OverviewResource;
}): React.ReactElement | null => {
  if (overview.reference_date === null) return null;
  const month = overview.totals.month;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div className="flex flex-col gap-1">
        <Label>Patrimônio · {overview.scope.name}</Label>
        <PrincipalMoney value={overview.totals.value} />
        {month === null ? null : (
          <p className="flex flex-wrap items-baseline gap-2 text-[0.8125rem]">
            <span className="flex items-baseline gap-2 font-semibold">
              <MoneyChange value={month.amount} />
              <span aria-hidden="true" className="font-normal text-ink-3">
                ·
              </span>
              <PercentChange value={percentAsRatio(month.ratio)} />
            </span>
            <span className="text-xs text-ink-3">
              em {monthLabel(overview.reference_date as DateOnly)}
            </span>
          </p>
        )}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[0.8125rem]">
        <div>
          <dt className="text-xs text-ink-3">Rentabilidade 12M</dt>
          <dd className="tabular">
            <PercentChange value={percentAsRatio(overview.period.return_pct)} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Aportes 12M</dt>
          <dd className="tabular">
            <Money value={overview.period.contributions} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Rendimento 12M</dt>
          <dd className="tabular">
            <MoneyChange value={overview.period.income} />
          </dd>
        </div>
      </dl>
    </div>
  );
};

export const GeralView = ({
  data,
  today,
  overview,
  goals,
  onNewEntry,
  onLaunched,
}: GeralViewProps): React.ReactElement => {
  const loaded = overview.state.kind === 'ready' ? overview.state.value : null;
  const navigate = useNavigate();
  const { slugs } = usePortfolios();
  const onOpenPortfolio = (id: string): void => {
    const target = scopeForPortfolioId(id, slugs);
    if (target !== null) void navigate(routes.home('investimentos', target));
  };
  // VGR-15.2: em Tudo e Fluxo o `N` abre despesa, como o botão; em Investimentos
  // vale o `N` global, que abre aporte.
  const shortcuts = useMemo(() => ({ new_transaction: onNewEntry }), [onNewEntry]);
  useShortcuts(shortcuts);
  return (
    <>
      <ScreenHeader
        title="Visão geral"
        subtitle={`Hoje · ${formatDate(today as DateOnly)} · Finanças e todas as carteiras juntos`}
        period={<HomeScopeControl scope="tudo" />}
        primary={{ label: 'Lançamento', onClick: onNewEntry }}
      />
      <div className="flex flex-col gap-4">
        {/* Cards na mesma linha têm a mesma altura (grid com itens esticados). */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PanelBoundary title="o patrimônio">
            <PatrimonioPanel data={data} today={today} overview={loaded} />
          </PanelBoundary>
          <PanelBoundary title="o fluxo do mês">
            <FluxoDoMesPanel today={today} />
          </PanelBoundary>
          <PanelBoundary title="o saldo previsto">
            <SaldoPrevistoPanel today={today} />
          </PanelBoundary>
        </div>

        <Panel
          title="Evolução dos investimentos"
          hint="últimos 12 meses · todas as carteiras"
          action={
            <Link to={routes.home('investimentos', ALL_SCOPE)} className={LINK}>
              Investimentos →
            </Link>
          }
        >
          {overview.state.kind === 'loading' ? (
            <div className="p-4">
              <InvestmentsLoading />
            </div>
          ) : overview.state.kind === 'error' ? (
            <InvestmentsFailed error={overview.state.error} onRetry={overview.reload} />
          ) : (
            <KeepPrevious pending={overview.pending} className="flex flex-col gap-4 p-4">
              <EvolutionHeader overview={overview.state.value} />
              <Evolution overview={overview.state.value} />
            </KeepPrevious>
          )}
        </Panel>

        <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
          <Panel
            title="Alocação por classe"
            hint="soma das carteiras · posição de hoje"
            className="flex flex-col"
            action={
              <Link to={routes.home('investimentos', ALL_SCOPE)} className={LINK}>
                Investimentos →
              </Link>
            }
          >
            {loaded === null ? (
              <p className="p-4 text-[0.8125rem] text-ink-3">
                {overview.state.kind === 'error'
                  ? 'Indisponível: os investimentos não carregaram.'
                  : 'Carregando…'}
              </p>
            ) : (
              <ClassesTable
                overview={loaded}
                classHref={(id) =>
                  `${routes.portfolio(ALL_SCOPE, 'posicoes')}?classe=${encodeURIComponent(id)}`
                }
              />
            )}
          </Panel>

          <Panel
            title="Carteiras"
            hint="posição de hoje"
            className="flex flex-col"
            action={
              <Link to={routes.home('investimentos', ALL_SCOPE)} className={LINK}>
                Investimentos →
              </Link>
            }
          >
            {loaded === null ? (
              <p className="p-4 text-[0.8125rem] text-ink-3">
                {overview.state.kind === 'error'
                  ? 'Indisponível: os investimentos não carregaram.'
                  : 'Carregando…'}
              </p>
            ) : (
              <PortfoliosPanel overview={loaded} onOpenPortfolio={onOpenPortfolio} />
            )}
          </Panel>

          <Panel
            title="Objetivos"
            hint="posição de hoje"
            className="flex flex-col xl:col-span-2"
            action={
              <Link to={routes.portfolio(ALL_SCOPE, 'objetivos')} className={LINK}>
                Objetivos →
              </Link>
            }
          >
            <GoalPanelBody goals={goals} portfolioId={null} />
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PanelBoundary title="os próximos lançamentos">
            <ProximosLancamentosPanel data={data} today={today} onLaunched={onLaunched} />
          </PanelBoundary>
          <div className="flex min-w-0 flex-col gap-4">
            <PanelBoundary title="as faturas abertas">
              <FaturasAbertasPanel data={data} today={today} />
            </PanelBoundary>
            <PanelBoundary title="as contas">
              <ContasPanel data={data} today={today} />
            </PanelBoundary>
          </div>
        </div>
      </div>
    </>
  );
};

/**
 * A rota: os dados de Finanças vêm do provedor compartilhado com a área de
 * Finanças, e os de investimentos, de uma leitura de Todas as carteiras.
 */
export const GeralScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const store = useFinanceStore();
  const { today } = useFinancePeriod();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const openCreating = useCallback(() => setCreating(true), []);

  const range = resolvePeriod(DEFAULT_PERIOD, today as DateOnly, null);
  const overview = useResource(
    (signal) =>
      fetchOverview({ portfolioId: null, from: range.from, to: range.to }, signal),
    [range.from, range.to],
  );
  const goals = useResource((signal) => fetchGoalsOverview({}, signal), []);

  return (
    <>
      <GeralView
        data={data}
        today={today}
        overview={overview}
        goals={goals}
        onNewEntry={openCreating}
        onLaunched={() => store.start()}
      />
      {creating ? (
        <EntryDialog
          mode="new"
          onSaveAndNew={(draft) => store.run(commands.addEntry(draft, today))}
          data={data}
          today={today}
          initial={emptyEntryDraft(today)}
          onClose={() => setCreating(false)}
          onCreateRecurring={() => void navigate(financeRoutes.recurrings())}
          onSave={(draft) => {
            store.run(commands.addEntry(draft, today));
            setCreating(false);
          }}
        />
      ) : null}
    </>
  );
};
