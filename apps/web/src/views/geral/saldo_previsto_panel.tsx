import { SkeletonChart, SkeletonRegion } from '../../components/skeleton.js';
import type { DateOnly } from '@patrimonio/domain';
import { Link } from 'react-router';

import { fetchForecast } from '../../api/forecast.js';
import { Panel } from '../../components/primitives.js';
import { SeriesChart } from '../../components/series_chart.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { Amount } from '../../finance/components/amount.js';
import { PanelError } from '../../finance/components/states.js';
import { endOfMonth } from '../../finance/lib/dates.js';
import type { IsoDate } from '../../finance/lib/dates.js';
import { formatPercentTenths } from '../../finance/lib/format.js';
import { decimalToCents } from '../../finance/lib/money.js';
import type { Cents } from '../../finance/lib/money.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { formatDate } from '../../lib/overview.js';
import { useResource } from '../../lib/use_resource.js';

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
    body = (
      <SkeletonRegion label="Carregando o saldo previsto" className="p-4">
        <SkeletonChart className="[&>span:first-child]:h-64" />
      </SkeletonRegion>
    );
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
