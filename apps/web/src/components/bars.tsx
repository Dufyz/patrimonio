import { toPercentNumber } from '../lib/chart/scale.js';
import { colorForToken } from '../lib/tokens.js';
import { Money, Percent, Points } from './number.js';
import { Label } from './primitives.js';

/**
 * D-07 · Barras de proporção, no lugar de pizza e donut.
 *
 * O motivo é de leitura, não de gosto: comparar ângulo é pior que comparar
 * comprimento, e a pergunta que estas barras respondem é sempre de comparação —
 * quanto isto é do todo, quanto falta para o alvo, quanto veio de aporte. A
 * prancha 03 é explícita: nenhuma pizza em nenhuma tela.
 *
 * Todas elas são `<div>` com largura percentual, e não SVG: a barra precisa
 * reagir ao tamanho do painel sem medir nada, e percentual de CSS faz isso de
 * graça.
 */

const widthOf = (ratio: string | null): string => {
  const percent = toPercentNumber(ratio);
  // Barra nunca passa de 100%: o excedente vira texto, como a prancha 18 manda.
  return `${Math.max(0, Math.min(100, percent ?? 0))}%`;
};

/**
 * Alocação atual contra alvo. A marca é o alvo; o desvio em pontos percentuais
 * fica ao lado, porque "está 4,2 pp acima" é acionável e "a barra passou um
 * pouco da marca" não é.
 */
export const AllocationBar = ({
  label,
  colorToken,
  current,
  target,
  deviation,
  withinTolerance = true,
}: {
  readonly label: string;
  readonly colorToken: string;
  readonly current: string | null;
  readonly target: string | null;
  readonly deviation: string | null;
  readonly withinTolerance?: boolean;
}): React.ReactElement => (
  <div className="flex items-center gap-3">
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-xs"
        style={{ backgroundColor: colorForToken(colorToken) }}
      />
      <span className="truncate text-[0.8125rem]">{label}</span>
    </span>

    <span
      className="relative h-2 w-1/2 shrink-0 rounded-xs bg-panel-2"
      role="img"
      aria-label={`${label}: atual contra alvo`}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-xs"
        style={{ width: widthOf(current), backgroundColor: colorForToken(colorToken) }}
      />
      {target === null ? null : (
        <span
          aria-hidden="true"
          className="absolute inset-y-[-3px] w-px bg-ink"
          style={{ left: widthOf(target) }}
        />
      )}
    </span>

    <span className="w-16 shrink-0 text-right">
      <Percent value={current} decimals={1} />
    </span>
    <span className="w-20 shrink-0 text-right">
      <Points value={deviation} tone={withinTolerance ? 'muted' : 'attention'} />
    </span>
  </div>
);

export type CompositionSlice = {
  readonly id: string;
  readonly label: string;
  readonly colorToken: string;
  readonly share: string | null;
};

/**
 * Composição por classe, por carteira ou por instituição: uma barra só,
 * dividida. Fatia menor que meio por cento ainda aparece, com largura mínima —
 * sumir seria dizer que não existe.
 */
export const CompositionBar = ({
  slices,
  label,
}: {
  readonly slices: readonly CompositionSlice[];
  readonly label: string;
}): React.ReactElement => (
  <div
    className="flex h-3 w-full overflow-hidden rounded-xs"
    role="img"
    aria-label={label}
  >
    {slices.map((slice) => (
      <span
        key={slice.id}
        title={`${slice.label} · ${slice.share ?? '—'}`}
        className="min-w-0.5 first:rounded-l-xs last:rounded-r-xs"
        style={{
          width: widthOf(slice.share),
          backgroundColor: colorForToken(slice.colorToken),
        }}
      />
    ))}
  </div>
);

/**
 * De onde veio o crescimento: aporte de um lado, rentabilidade do outro. É a
 * resposta visual à segunda pergunta do produto, e o rótulo fica nas duas
 * pontas porque os dois números importam.
 */
export const GrowthOriginBar = ({
  contributionsShare,
  contributions,
  returns,
}: {
  readonly contributionsShare: string | null;
  readonly contributions: string | null;
  readonly returns: string | null;
}): React.ReactElement => (
  <div className="flex flex-col gap-1.5">
    <div
      className="flex h-3 w-full overflow-hidden rounded-xs"
      role="img"
      aria-label="Origem do crescimento"
    >
      <span
        className="bg-area-contributions"
        style={{ width: widthOf(contributionsShare) }}
      />
      <span className="flex-1 bg-area-return" />
    </div>
    <div className="flex justify-between text-[0.8125rem]">
      <span className="flex gap-2">
        <span className="text-ink-2">Aportes</span>
        <Money value={contributions} />
      </span>
      <span className="flex gap-2">
        <span className="text-ink-2">Rendimento</span>
        <Money value={returns} />
      </span>
    </div>
  </div>
);

/**
 * Progresso de objetivo. A marca é onde o objetivo deveria estar hoje para
 * chegar no prazo; passar dela é o que separa "no caminho" de "atrasado".
 *
 * A barra para em 100%. Objetivo atingido com excedente mostra o excedente em
 * texto — uma barra de 104% não tem onde desenhar os 4%.
 */
export const GoalProgressBar = ({
  label,
  caption,
  progress,
  expected,
  state = 'on_track',
}: {
  readonly label: string;
  readonly caption?: string | undefined;
  readonly progress: string | null;
  readonly expected?: string | null | undefined;
  readonly state?: 'on_track' | 'behind' | 'reached';
}): React.ReactElement => (
  <div className="flex items-center gap-4">
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[0.8125rem] font-medium">{label}</span>
      {caption === undefined ? null : (
        <span
          className={`block truncate text-[0.75rem] ${
            state === 'behind' ? 'text-negative' : 'text-ink-3'
          }`}
        >
          {caption}
        </span>
      )}
    </span>

    <span
      className="relative h-2 w-2/5 shrink-0 rounded-xs bg-panel-2"
      role="img"
      aria-label={label}
    >
      <span
        className={`absolute inset-y-0 left-0 rounded-xs ${
          state === 'behind'
            ? 'bg-negative'
            : state === 'reached'
              ? 'bg-positive'
              : 'bg-accent'
        }`}
        style={{ width: widthOf(progress) }}
      />
      {expected === null || expected === undefined ? null : (
        <span
          aria-hidden="true"
          title="onde deveria estar hoje"
          className="absolute inset-y-[-3px] w-px bg-ink"
          style={{ left: widthOf(expected) }}
        />
      )}
    </span>

    <span className="w-14 shrink-0 text-right">
      <Percent value={progress} decimals={0} />
    </span>
  </div>
);

export const BarLegend = ({
  slices,
}: {
  readonly slices: readonly CompositionSlice[];
}): React.ReactElement => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1">
    {slices.map((slice) => (
      <li key={slice.id} className="flex items-center gap-1.5 text-[0.8125rem]">
        <span
          aria-hidden="true"
          className="size-2 rounded-xs"
          style={{ backgroundColor: colorForToken(slice.colorToken) }}
        />
        <span className="text-ink-2">{slice.label}</span>
        <Percent value={slice.share} decimals={1} />
      </li>
    ))}
  </ul>
);

export const BarSectionLabel = Label;
