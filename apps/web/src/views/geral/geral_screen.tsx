import type { GoalsOverviewResource, OverviewResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { fetchGoalsOverview } from '../../api/goals.js';
import { fetchOverview } from '../../api/overview.js';
import { KeepPrevious } from '../../components/pending.js';
import { Panel } from '../../components/primitives.js';
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
import { PanelBoundary } from '../../finance/components/states.js';
import { accountsTotal, monthFlow } from '../../finance/domain/cash_flow.js';
import { emptyEntryDraft } from '../../finance/domain/entry_ops.js';
import type { FinanceData } from '../../finance/domain/types.js';
import type { IsoDate } from '../../finance/lib/dates.js';
import { formatMonth } from '../../finance/lib/format.js';
import { decimalToCents } from '../../finance/lib/money.js';
import type { Cents } from '../../finance/lib/money.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { useFinanceData, useFinanceStore } from '../../finance/store/finance_store.js';
import { commands } from '../../finance/store/commands.js';
import { DEFAULT_PERIOD, resolvePeriod } from '../../lib/period.js';
import { formatDate } from '../../lib/overview.js';
import { routes } from '../../lib/routes.js';
import { ALL_SCOPE } from '../../lib/scope.js';
import type { Resource } from '../../lib/use_resource.js';
import { useResource } from '../../lib/use_resource.js';
import { ClassesTable } from '../overview_classes.js';
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
}: {
  readonly label: string;
  readonly to?: string | undefined;
  readonly cents: Cents | null;
  readonly sign?: '+' | '−' | undefined;
  readonly strong?: boolean;
}): React.ReactElement => (
  <tr className={`border-t border-line ${strong ? 'bg-panel-2 font-semibold' : ''}`}>
    <th scope="row" className="px-3 py-[var(--row-pad)] text-left font-[inherit]">
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
  investments,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
  /** O valor de Todas as carteiras; nulo enquanto a leitura não chega. */
  readonly investments: Cents | null;
}): React.ReactElement => {
  const inAccounts = useMemo(() => accountsTotal(data, today), [data, today]);
  const total = investments === null ? null : inAccounts + investments;

  return (
    <Panel
      title="Patrimônio"
      action={<span className="text-xs text-ink-3">em {formatDate(today)}</span>}
      className="flex flex-col"
    >
      <div className="px-4 pt-4 pb-2">
        <p className="tabular text-[1.75rem] leading-9 font-semibold">
          {total === null ? <Muted>—</Muted> : <Amount cents={total} />}
        </p>
        <p className="text-xs text-ink-3">em contas + em carteiras</p>
      </div>
      <FinTable caption="Composição do patrimônio" fill>
        <THead>
          <Th>Composição</Th>
          <Th align="right">Valor</Th>
        </THead>
        <tbody>
          <Line label="Em contas" to={financeRoutes.accounts()} cents={inAccounts} />
          <Line
            label="Em carteiras"
            to={routes.investments(ALL_SCOPE)}
            cents={investments}
          />
          <FillRow colSpan={2} />
          <Line label="Patrimônio" cents={total} strong />
        </tbody>
      </FinTable>
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* GER-004 · Fluxo do mês                                                     */

export const FluxoDoMesPanel = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
}): React.ReactElement => {
  const flow = useMemo(() => monthFlow(data, today), [data, today]);

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
      <FinTable caption="Fluxo do mês" fill>
        <THead>
          <Th>Até {formatDate(flow.monthEnd as DateOnly)}</Th>
          <Th align="right">Valor</Th>
        </THead>
        <tbody>
          <Line
            label="Em contas hoje"
            to={financeRoutes.accounts()}
            cents={flow.emContasCents}
          />
          <Line label="Receitas previstas" cents={flow.receitasPrevistasCents} sign="+" />
          <Line label="Despesas previstas" cents={flow.despesasPrevistasCents} sign="−" />
          <Line
            label="Faturas a pagar"
            to={financeRoutes.cards()}
            cents={flow.faturasAPagarCents}
            sign="−"
          />
          <Line
            label="Saldo previsto ao fim do mês"
            cents={flow.saldoPrevistoCents}
            strong
          />
        </tbody>
      </FinTable>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-[0.8125rem] sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-3">Receitas do mês</dt>
          <dd className="tabular">
            <Amount cents={flow.receitasCents} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Despesas lançadas</dt>
          <dd className="tabular">
            <Amount cents={flow.despesasRealizadasCents} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Aportes previstos</dt>
          <dd className="tabular">
            <Amount cents={flow.aportesPrevistosCents} />
          </dd>
        </div>
      </dl>
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

export const GeralView = ({
  data,
  today,
  overview,
  goals,
  onNewEntry,
}: GeralViewProps): React.ReactElement => {
  const navigate = useNavigate();
  const loaded = overview.state.kind === 'ready' ? overview.state.value : null;
  const investments =
    loaded === null
      ? null
      : loaded.reference_date === null
        ? 0
        : (decimalToCents(loaded.totals.value ?? '0') ?? 0);

  return (
    <>
      <ScreenHeader
        title="Visão geral"
        subtitle={`Hoje · ${formatDate(today as DateOnly)} · Finanças e todas as carteiras juntos`}
        primary={{ label: 'Lançamento', onClick: onNewEntry }}
      />
      <div className="flex flex-col gap-4">
        {/* Cards na mesma linha têm a mesma altura (grid com itens esticados). */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PanelBoundary title="o patrimônio">
            <PatrimonioPanel data={data} today={today} investments={investments} />
          </PanelBoundary>
          <PanelBoundary title="o fluxo do mês">
            <FluxoDoMesPanel data={data} today={today} />
          </PanelBoundary>
        </div>

        <Panel
          title="Evolução dos investimentos"
          hint="últimos 12 meses · todas as carteiras"
          action={
            <Link to={routes.investments(ALL_SCOPE)} className={LINK}>
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
            <KeepPrevious pending={overview.pending} className="p-4">
              <Evolution overview={overview.state.value} />
            </KeepPrevious>
          )}
        </Panel>

        <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
          <Panel
            title="Alocação por classe"
            hint="soma das carteiras"
            className="flex flex-col"
            action={
              <Link to={routes.investments(ALL_SCOPE)} className={LINK}>
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
              <ClassesTable overview={loaded} />
            )}
          </Panel>

          <Panel
            title="Objetivos"
            className="flex flex-col"
            action={
              <Link to={routes.investments(ALL_SCOPE, 'objetivos')} className={LINK}>
                Objetivos →
              </Link>
            }
          >
            <GoalPanelBody
              goals={goals}
              portfolioId={null}
              onOpenGoals={() =>
                void navigate(routes.investments(ALL_SCOPE, 'objetivos'))
              }
            />
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PanelBoundary title="os próximos lançamentos">
            <ProximosLancamentosPanel
              data={data}
              today={today}
              more={{
                to: financeRoutes.entries('situacao=prevista'),
                label: 'Lançamentos',
              }}
            />
          </PanelBoundary>
          <div className="flex min-w-0 flex-col gap-4">
            <PanelBoundary title="as faturas abertas">
              <FaturasAbertasPanel
                data={data}
                today={today}
                more={{ to: financeRoutes.cards(), label: 'Cartões' }}
              />
            </PanelBoundary>
            <PanelBoundary title="as contas">
              <ContasPanel
                data={data}
                today={today}
                more={{ to: financeRoutes.accounts(), label: 'Contas' }}
              />
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
        onNewEntry={() => setCreating(true)}
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
