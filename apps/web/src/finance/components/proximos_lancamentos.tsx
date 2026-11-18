import type { BookRowResource } from '@patrimonio/contracts';

import { fetchBook } from '../../api/book.js';
import { fetchForecast } from '../../api/forecast.js';
import { Money } from '../../components/number.js';
import { Panel } from '../../components/primitives.js';
import { FillRow, FinTable, Th, THead } from '../../components/table_parts.js';
import { signOf } from '../../lib/ledger_book.js';
import { useResource } from '../../lib/use_resource.js';
import { addMonths, endOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { formatDay, formatMonth } from '../lib/format.js';
import { centsToDecimal } from '../lib/money.js';
import { financeRoutes } from '../lib/routes.js';
import { EmptyPanel, PanelError, PanelLoading } from './states.js';
import { PanelHeaderAction } from './overview_panels.js';
import { KindTag } from './tags.js';

/**
 * VGR-09 · Próximos lançamentos, como nas pranchas 1.1 e 1.2: o que ainda vai
 * entrar e sair — receitas, despesas, aportes e pagamentos de fatura previstos —
 * lido do livro do servidor, do mais próximo ao mais distante. O rodapé diz
 * quantos faltam no mês e o saldo previsto em contas no fim dele, o mesmo da
 * previsão de Contas (RN-U16). Lançar um previsto se faz em Lançamentos.
 */

const SHOWN = 9;

const KIND_LABEL: Readonly<Record<string, string>> = {
  APORTE: 'Aporte',
  RECEITA: 'Receita',
  PROVENTO: 'Provento',
  DESPESA: 'Despesa',
  PAGAMENTO_FATURA: 'Pag. de fatura',
  RESGATE: 'Resgate',
  TRANSFERENCIA: 'Transferência',
  EVENTO: 'Evento',
};

/** A cor do valor: receita e provento em verde, aporte em azul, o resto na tinta. */
const valueTone = (kind: string): string =>
  kind === 'RECEITA' || kind === 'PROVENTO'
    ? 'text-positive'
    : kind === 'APORTE'
      ? 'text-accent'
      : '';

const SignedValue = ({ row }: { readonly row: BookRowResource }): React.ReactElement => {
  const sign = signOf(row.kind);
  return (
    <span className={valueTone(row.kind)}>
      {sign === '' ? null : <span aria-hidden="true">{sign === '-' ? '−' : '+'}</span>}
      <Money value={row.amount ?? '0'} bare />
    </span>
  );
};

export const ProximosLancamentosPanel = ({
  today,
}: {
  readonly today: IsoDate;
}): React.ReactElement => {
  const monthEnd = endOfMonth(today);
  // "A partir de hoje": o que está previsto até o fim do mês seguinte, onde os
  // recorrentes e as faturas já têm data. O vencido que ainda não foi lançado
  // continua na lista, em vermelho, e conta a partir de hoje (RN-13).
  const since = addMonths(today, -12);
  const until = endOfMonth(addMonths(today, 1));
  const book = useResource(
    (signal) =>
      fetchBook({ from: since, to: until, situacao: ['previsto'], limit: 200 }, signal),
    [since, until],
  );
  const forecast = useResource(
    (signal) => fetchForecast({ from: `${today.slice(0, 7)}-01`, to: monthEnd }, signal),
    [today, monthEnd],
  );

  const state = book.state;
  let body: React.ReactElement;
  if (state.kind === 'loading') {
    body = <PanelLoading label="Carregando as próximas movimentações" />;
  } else if (state.kind === 'error') {
    body = (
      <PanelError
        title="Não foi possível carregar as próximas movimentações"
        onRetry={book.reload}
      />
    );
  } else {
    const planned = [...state.value.rows].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    const shown = planned.slice(0, SHOWN);
    // O total das linhas mostradas, com o sinal de cada uma: o efeito no caixa.
    const net = centsToDecimal(
      shown.reduce((acc, row) => {
        const cents = Math.round(Number(row.amount ?? '0') * 100);
        const sign = signOf(row.kind);
        return sign === '-' ? acc - cents : sign === '+' ? acc + cents : acc;
      }, 0),
    );
    const inMonth = planned.filter((row) => row.date <= monthEnd).length;
    const balance =
      forecast.state.kind === 'ready' ? forecast.state.value.parts.saldo : null;

    body =
      shown.length === 0 ? (
        <EmptyPanel message="Nada previsto." />
      ) : (
        <>
          <FinTable caption="Próximas movimentações" fill>
            <THead>
              <Th>Dia</Th>
              <Th>Descrição</Th>
              <Th>Tipo</Th>
              <Th align="right">Valor (R$)</Th>
            </THead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td
                    className={`tabular py-[var(--row-pad)] pl-3 ${
                      row.date < today ? 'text-negative' : 'text-ink-2'
                    }`}
                  >
                    {formatDay(row.date as IsoDate, today)}
                  </td>
                  <td className="px-3 py-[var(--row-pad)] font-medium">
                    {row.description}
                  </td>
                  <td className="px-3 py-[var(--row-pad)]">
                    <KindTag kind={row.kind}>{KIND_LABEL[row.kind] ?? row.kind}</KindTag>
                  </td>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right font-medium">
                    <SignedValue row={row} />
                  </td>
                </tr>
              ))}
              <FillRow colSpan={4} />
              <tr className="border-t border-line-2 bg-panel-2 font-semibold">
                <th
                  scope="row"
                  colSpan={3}
                  className="py-[var(--row-pad)] pl-3 text-left font-[inherit]"
                >
                  {shown.length < planned.length
                    ? `Total dos ${shown.length} próximos`
                    : 'Total'}
                </th>
                <td className="tabular px-3 py-[var(--row-pad)] text-right">
                  <span className={net.startsWith('-') ? '' : 'text-positive'}>
                    <span aria-hidden="true">{net.startsWith('-') ? '−' : '+'}</span>
                    <Money value={net.replace(/^-/, '')} bare />
                  </span>
                </td>
              </tr>
            </tbody>
          </FinTable>
          <footer className="flex flex-wrap items-baseline justify-between gap-3 border-t border-line px-4 py-3 text-[0.8125rem] text-ink-2">
            <span>
              {inMonth} {inMonth === 1 ? 'previsto' : 'previstos'} em{' '}
              {formatMonth(today).split('/')[0]} · saldo previsto em contas em{' '}
              {formatDay(monthEnd, today)}
            </span>
            <span className="tabular font-semibold text-ink">
              {balance === null ? (
                <span className="text-ink-3">—</span>
              ) : (
                <Money value={balance} />
              )}
            </span>
          </footer>
        </>
      );
  }

  return (
    <Panel
      title="Próximas movimentações"
      action={
        <PanelHeaderAction
          hint="previstos a partir de hoje"
          more={{ to: financeRoutes.entries('situacao=previsto'), label: 'Ver todas' }}
        />
      }
      className="h-full"
    >
      {body}
    </Panel>
  );
};
