import { SkeletonBar } from '../../components/skeleton.js';
import { fetchBook } from '../../api/book.js';
import { fetchForecast } from '../../api/forecast.js';
import { Money, MoneyChange } from '../../components/number.js';
import { formatDate } from '../../lib/overview.js';
import { useResource } from '../../lib/use_resource.js';
import { endOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { financeRoutes } from '../lib/routes.js';
import { StatStrip } from './stat_strip.js';
import type { StatCell } from './stat_strip.js';
import type { DateOnly } from '@patrimonio/domain';

/**
 * A faixa de indicadores do Fluxo (prancha 1.2): Receitas, Despesas, Aportes,
 * Saldo do mês e Saldo previsto em contas. Receitas, despesas e aportes vêm do
 * livro do mês, lançado e previsto; o saldo previsto, da previsão de Contas
 * (RN-U16): nenhuma célula soma por conta própria.
 */
export const FluxoStats = ({
  today,
}: {
  readonly today: IsoDate;
}): React.ReactElement => {
  const month = today.slice(0, 7);
  const to = endOfMonth(today);
  const book = useResource((signal) => fetchBook({ month, limit: 1 }, signal), [month]);
  const forecast = useResource(
    (signal) => fetchForecast({ from: today, to }, signal),
    [today, to],
  );
  const totals = book.state.kind === 'ready' ? book.state.value.totals : null;
  const saldo = forecast.state.kind === 'ready' ? forecast.state.value.parts.saldo : null;
  // Carregando é esqueleto; só a falha vira traço (nunca um zero de mentira).
  const bookDash =
    book.state.kind === 'loading' ? (
      <SkeletonBar className="mt-1 h-6 w-36" />
    ) : (
      <span className="text-ink-3">—</span>
    );
  const forecastDash =
    forecast.state.kind === 'loading' ? (
      <SkeletonBar className="mt-1 h-6 w-36" />
    ) : (
      <span className="text-ink-3">—</span>
    );
  const loadingCaption =
    book.state.kind === 'loading' ? <SkeletonBar className="mt-1 h-2.5 w-40" /> : null;
  const link = (tipo: string): string =>
    financeRoutes.entries(`tipo=${tipo}&situacao=lancado`);

  const cells: readonly StatCell[] = [
    {
      id: 'receitas',
      label: 'Receitas',
      value: totals === null ? bookDash : <Money value={totals.receitas} />,
      caption:
        totals === null ? (
          (loadingCaption ?? undefined)
        ) : (
          <>
            previstas no mês <Money value={totals.projetado.receitas} />
          </>
        ),
      to: link('RECEITA'),
    },
    {
      id: 'despesas',
      label: 'Despesas',
      value: totals === null ? bookDash : <Money value={totals.despesas} />,
      caption:
        totals === null ? (
          (loadingCaption ?? undefined)
        ) : (
          <>
            consumo · previstas <Money value={totals.projetado.despesas} />
          </>
        ),
      to: link('DESPESA'),
    },
    {
      id: 'aportes',
      label: 'Aportes',
      value: totals === null ? bookDash : <Money value={totals.aportes} />,
      caption: loadingCaption ?? 'despesa financeira',
      to: link('APORTE'),
    },
    {
      id: 'saldo',
      label: 'Saldo do mês',
      value: totals === null ? bookDash : <MoneyChange value={totals.saldo_do_mes} />,
      caption: loadingCaption ?? 'receitas – despesas – aportes de contas',
    },
    {
      id: 'previsto',
      label: 'Saldo previsto em contas',
      value: saldo === null ? forecastDash : <Money value={saldo} />,
      caption: `em ${formatDate(to as DateOnly).slice(0, 5)}, com tudo o que está previsto`,
    },
  ];
  return <StatStrip cells={cells} label="Indicadores do mês" />;
};
