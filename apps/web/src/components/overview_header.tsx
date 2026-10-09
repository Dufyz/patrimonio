import { MoneyChange, PercentChange, PrincipalMoney } from './number.js';
import { Label } from './primitives.js';

/**
 * D-05 · O cabeçalho de visão geral.
 *
 * O mesmo bloco abre Visão geral, Posições, Desempenho e a tela de carteira, e
 * a ordem dentro dele é a resposta da tela: o número principal primeiro, a
 * variação dele no período logo abaixo, as métricas de apoio depois e o gráfico
 * ocupando o resto da largura.
 *
 * Quatro métricas é o teto. A quinta métrica que alguém quer acrescentar quase
 * sempre é a primeira que ninguém lê, e o cabeçalho é a parte da tela em que
 * densidade vira ruído mais rápido.
 */

export const MAX_SUPPORT_METRICS = 4;

export type SupportMetric = {
  readonly label: string;
  readonly value: React.ReactNode;
};

export type OverviewHeaderProps = {
  /** `PATRIMÔNIO · TODAS AS CARTEIRAS`. */
  readonly label: string;
  readonly principal: string | null;
  readonly change?:
    | {
        readonly amount: string | null;
        readonly ratio: string | null;
        /** `em outubro`, `em 12 meses`. */
        readonly periodLabel: string;
      }
    | undefined;
  readonly metrics?: readonly SupportMetric[] | undefined;
  /** Ressalva de dado desatualizado, junto do número principal. */
  readonly caveat?: string | undefined;
  /** O gráfico, ou o convite a lançar quando ainda não há série. */
  readonly chart?: React.ReactNode;
};

export const OverviewHeader = ({
  label,
  principal,
  change,
  metrics = [],
  caveat,
  chart,
}: OverviewHeaderProps): React.ReactElement => (
  <section className="grid grid-cols-1 overflow-hidden rounded-panel border border-line bg-panel lg:grid-cols-[minmax(18rem,22rem)_1fr]">
    <div className="flex flex-col gap-3 border-line p-5 lg:border-r">
      <Label>{label}</Label>

      <div className="flex flex-col gap-1">
        <PrincipalMoney value={principal} />

        {change === undefined ? null : (
          <p className="flex flex-wrap items-baseline gap-2 text-[0.8125rem]">
            <MoneyChange value={change.amount} />
            <span aria-hidden="true" className="text-ink-3">
              ·
            </span>
            <PercentChange value={change.ratio} />
            <span className="text-ink-2">{change.periodLabel}</span>
          </p>
        )}

        {caveat === undefined ? null : (
          <p className="text-[0.75rem] text-attention">{caveat}</p>
        )}
      </div>

      {metrics.length === 0 ? null : (
        <dl className="mt-1 border-t border-line">
          {metrics.slice(0, MAX_SUPPORT_METRICS).map((metric) => (
            <div
              key={metric.label}
              className="flex h-(--row-height) items-center justify-between gap-4 border-b border-line last:border-b-0"
            >
              <dt className="truncate text-[0.8125rem] text-ink-2">{metric.label}</dt>
              <dd className="shrink-0 text-[0.8125rem]">{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>

    <div className="min-w-0 p-4">{chart}</div>
  </section>
);
