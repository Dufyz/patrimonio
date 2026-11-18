import { SkeletonRegion, SkeletonTable } from '../../components/skeleton.js';
import type {
  GoalsOverviewResource,
  OverviewResource,
  PerformanceResource,
} from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { NewEntryModal } from '../ledger/new_entry_modal.js';

import { fetchGoalsOverview } from '../../api/goals.js';
import { fetchOverview } from '../../api/overview.js';
import { fetchPerformance } from '../../api/performance.js';
import { HomeScopeControl } from '../../components/home_scope_control.js';
import { PeriodControl } from '../../components/period_control.js';
import { useShortcuts } from '../../components/shortcuts.js';
import { Panel } from '../../components/primitives.js';
import {
  ContasPanel,
  FaturasAbertasPanel,
} from '../../finance/components/overview_panels.js';
import { ProximosLancamentosPanel } from '../../finance/components/proximos_lancamentos.js';
import { useFinancePeriod } from '../../finance/components/period_provider.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { PanelBoundary } from '../../finance/components/states.js';
import type { FinanceData } from '../../finance/domain/types.js';
import type { IsoDate } from '../../finance/lib/dates.js';
import { useFinanceData, useFinanceStore } from '../../finance/store/finance_store.js';
import { formatDate } from '../../lib/overview.js';
import type { Period } from '../../lib/period.js';
import {
  DEFAULT_PERIOD,
  decodePeriod,
  encodePeriod,
  resolvePeriod,
  windowLabel,
} from '../../lib/period.js';
import { routes } from '../../lib/routes.js';
import { ALL_SCOPE } from '../../lib/scope.js';
import type { Resource } from '../../lib/use_resource.js';
import { useResource } from '../../lib/use_resource.js';
import { AlocacaoPanel } from './alocacao_panel.js';
import { EvolucaoPanel } from './evolucao_panel.js';
import { FluxoDoMesPanel } from './fluxo_panel.js';
import { ObjetivosPanel } from './objetivos_panel.js';
import { PatrimonioPanel } from './patrimonio_panel.js';

/**
 * A Visão geral · Tudo (prancha 1.1): o patrimônio inteiro, Finanças e todas as
 * carteiras juntos. Cada painel resume uma tela que existe em outra área e leva
 * a ela; nenhum número nasce aqui. A ordem, de cima para baixo: Patrimônio |
 * Fluxo do mês; Evolução; Alocação por classe | Objetivos; Próximos lançamentos
 * | Faturas abertas sobre Contas. O saldo previsto do fim do mês aparece no
 * rodapé de Próximos lançamentos, o mesmo da previsão de Contas (RN-U16).
 */

export type GeralViewProps = {
  readonly data: FinanceData;
  readonly today: IsoDate;
  readonly overview: Resource<OverviewResource>;
  readonly performance: Resource<PerformanceResource>;
  readonly goals: Resource<GoalsOverviewResource>;
  readonly period: Period;
  readonly onPeriodChange: (period: Period) => void;
  readonly inception: DateOnly | null;
  readonly onNewEntry: () => void;
};

/** Duas colunas da prancha: a esquerda mais estreita (Patrimônio) ou mais larga (Próximos). */
const NARROW_WIDE = 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]';
const WIDE_NARROW = 'xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]';

export const GeralView = ({
  data,
  today,
  overview,
  performance,
  goals,
  period,
  onPeriodChange,
  inception,
  onNewEntry,
}: GeralViewProps): React.ReactElement => {
  const loaded = overview.state.kind === 'ready' ? overview.state.value : null;
  const returns = performance.state.kind === 'ready' ? performance.state.value : null;
  // VGR-15.2: em Tudo e Fluxo o `N` abre despesa, como o botão; em Investimentos
  // vale o `N` global, que abre aporte.
  const shortcuts = useMemo(() => ({ new_transaction: onNewEntry }), [onNewEntry]);
  useShortcuts(shortcuts);

  const consolidation =
    loaded?.reference_date == null ? null : formatDate(loaded.reference_date as DateOnly);

  return (
    <>
      <ScreenHeader
        title="Visão geral"
        subtitle={`Tudo · hoje, ${formatDate(today as DateOnly)}${
          consolidation === null
            ? ''
            : ` · investimentos consolidados em ${consolidation}`
        }`}
        period={
          <span className="flex flex-wrap items-center gap-2">
            <HomeScopeControl scope="tudo" />
            <PeriodControl
              value={period}
              onChange={onPeriodChange}
              today={today}
              inception={inception}
            />
          </span>
        }
        primary={{ label: 'Movimentação', onClick: onNewEntry }}
      />
      <div className="flex flex-col gap-4">
        {/* Cards na mesma linha têm a mesma altura (grid com itens esticados). */}
        <div className={`grid grid-cols-1 gap-4 ${NARROW_WIDE}`}>
          <PanelBoundary title="o patrimônio">
            <PatrimonioPanel
              data={data}
              today={today}
              overview={loaded}
              loading={overview.state.kind === 'loading'}
            />
          </PanelBoundary>
          <PanelBoundary title="o fluxo do mês">
            <FluxoDoMesPanel today={today} />
          </PanelBoundary>
        </div>

        <EvolucaoPanel
          title="Evolução do patrimônio"
          label="Investimentos · Todas as carteiras"
          windowLabel={windowLabel(period)}
          overview={overview}
        />

        <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
          {loaded === null ? (
            <Panel title="Alocação por classe" className="flex flex-col">
              {overview.state.kind === 'error' ? (
                <p className="p-4 text-[0.8125rem] text-ink-3">
                  Indisponível: os investimentos não carregaram.
                </p>
              ) : (
                <SkeletonRegion label="Carregando a alocação">
                  <SkeletonTable rows={4} columns={5} />
                </SkeletonRegion>
              )}
            </Panel>
          ) : (
            <AlocacaoPanel
              overview={loaded}
              performance={returns}
              hint="somando as carteiras"
              classHref={(id) =>
                `${routes.portfolio(ALL_SCOPE, 'posicoes')}?classe=${encodeURIComponent(id)}`
              }
            />
          )}
          <ObjetivosPanel
            goals={goals}
            portfolioId={null}
            seeHref={routes.portfolio(ALL_SCOPE, 'objetivos')}
          />
        </div>

        <div className={`grid grid-cols-1 gap-4 ${WIDE_NARROW}`}>
          <PanelBoundary title="as próximas movimentações">
            <ProximosLancamentosPanel today={today} />
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
 * Finanças; os de investimentos, de uma leitura de Todas as carteiras no período
 * da URL (`periodo`, o mesmo de Investimentos, então trocar de escopo o mantém).
 */
export const GeralScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const store = useFinanceStore();
  const { today } = useFinancePeriod();
  const [creating, setCreating] = useState(false);
  const openCreating = useCallback(() => setCreating(true), []);

  const [params, setParams] = useSearchParams();
  const period = decodePeriod(params.get('periodo'));
  const onPeriodChange = useCallback(
    (next: Period) => {
      setParams(
        (current) => {
          const search = new URLSearchParams(current);
          const encoded = encodePeriod(next);
          if (encoded === encodePeriod(DEFAULT_PERIOD)) search.delete('periodo');
          else search.set('periodo', encoded);
          return search;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // "Início" só tem significado depois que a primeira resposta diz qual é o
  // primeiro fechamento; até lá vale a janela de doze meses.
  const [inception, setInception] = useState<DateOnly | null>(null);
  const range = resolvePeriod(period, today as DateOnly, inception);
  const overview = useResource(
    (signal) =>
      fetchOverview({ portfolioId: null, from: range.from, to: range.to }, signal),
    [range.from, range.to],
  );
  // O retorno do mês e do ano por classe: as tabelas não dependem do recorte.
  const performance = useResource(
    (signal) => fetchPerformance({ portfolioId: null }, signal),
    [],
  );
  const goals = useResource((signal) => fetchGoalsOverview({}, signal), []);

  useEffect(() => {
    if (overview.state.kind === 'ready') {
      setInception(overview.state.value.scope.inception as DateOnly | null);
    }
  }, [overview.state]);

  return (
    <>
      <GeralView
        data={data}
        today={today}
        overview={overview}
        performance={performance}
        goals={goals}
        period={period}
        onPeriodChange={onPeriodChange}
        inception={inception}
        onNewEntry={openCreating}
      />
      {creating ? (
        <NewEntryModal
          today={today}
          accounts={data.accounts
            .filter((account) => account.archived !== true)
            .map((account) => ({ id: account.id, name: account.name }))}
          onSaved={() => store.start()}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
};
