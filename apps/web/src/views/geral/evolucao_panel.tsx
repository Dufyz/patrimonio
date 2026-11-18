import type { OverviewResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';

import { KeepPrevious } from '../../components/pending.js';
import { PrincipalMoney } from '../../components/number.js';
import { Label, Panel } from '../../components/primitives.js';
import { SkeletonBar, SkeletonChart, SkeletonRegion } from '../../components/skeleton.js';
import { formatAxisFloor } from '../../lib/chart/scale.js';
import { formatDate } from '../../lib/overview.js';
import type { Resource } from '../../lib/use_resource.js';
import { Evolution, evolutionFloor } from '../overview.js';

/**
 * VGR-05 · A Evolução, na forma das pranchas 1.1, 1.3 e 1.4: o rótulo do escopo,
 * o patrimônio em destaque, a data da consolidação e o gráfico de aportes ×
 * rendimento com o eixo a partir de um piso redondo — dito no cabeçalho, porque
 * um eixo que não parte de zero precisa avisar. A legenda leva os três totais.
 * O valor é o de Em carteiras e o de Posições (RN-U16).
 */

/** De onde vêm os preços das posições de bolsa; a prancha diz isso sob o valor. */
const PRICE_NOTE = 'preços da B3 em D-1';

export const EvolucaoPanel = ({
  title,
  label,
  windowLabel,
  scopeHint,
  overview,
}: {
  readonly title: string;
  /** O rótulo em caixa alta acima do valor: "Investimentos · Todas as carteiras". */
  readonly label: string;
  /** "últimos 12 meses", ou o período escolhido. */
  readonly windowLabel: string;
  /** O escopo no cabeçalho, quando a tela não é o patrimônio inteiro. */
  readonly scopeHint?: string | undefined;
  readonly overview: Resource<OverviewResource>;
}): React.ReactElement => {
  const state = overview.state;
  const floor = state.kind === 'ready' ? evolutionFloor(state.value) : 0;
  const hint = [
    scopeHint,
    windowLabel,
    'aportes × rendimento',
    floor > 0 ? `eixo a partir de ${formatAxisFloor(floor)}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');

  return (
    <Panel
      title={title}
      action={<span className="text-xs text-ink-3">{hint}</span>}
      className="flex flex-col"
    >
      {state.kind === 'loading' ? (
        <div className="p-4">
          <SkeletonRegion label="Carregando a evolução" className="flex flex-col gap-4">
            <div aria-hidden="true" className="flex flex-col gap-2">
              <SkeletonBar className="h-2.5 w-44" />
              <SkeletonBar className="h-8 w-60" />
              <SkeletonBar className="h-2.5 w-72" />
            </div>
            <SkeletonChart className="[&>span:first-child]:h-64" />
          </SkeletonRegion>
        </div>
      ) : state.kind === 'error' ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-3 p-4 text-[0.8125rem] text-negative"
        >
          <span>Não foi possível carregar a evolução: {state.error.message}</span>
          <button
            type="button"
            className="h-control cursor-pointer rounded-control border border-line px-3 text-ink hover:bg-panel-2"
            onClick={overview.reload}
          >
            Tentar novamente
          </button>
        </p>
      ) : (
        <KeepPrevious pending={overview.pending} className="flex flex-col gap-4 p-4">
          {state.value.reference_date === null ? null : (
            <div className="flex flex-col gap-1">
              <Label>{label}</Label>
              <PrincipalMoney value={state.value.totals.value} />
              <p className="text-xs text-ink-3">
                consolidação em {formatDate(state.value.reference_date as DateOnly)} ·{' '}
                {PRICE_NOTE}
              </p>
            </div>
          )}
          <Evolution overview={state.value} />
        </KeepPrevious>
      )}
    </Panel>
  );
};
