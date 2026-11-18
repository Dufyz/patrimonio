import { SkeletonRegion, SkeletonTable } from '../../components/skeleton.js';
import type { BookResponse } from '@patrimonio/contracts';
import { Link } from 'react-router';

import { fetchBook } from '../../api/book.js';
import { Panel } from '../../components/primitives.js';
import { FillRow, FinTable, Th, THead } from '../../components/table_parts.js';
import { Amount } from '../../finance/components/amount.js';
import { PanelError } from '../../finance/components/states.js';
import type { IsoDate } from '../../finance/lib/dates.js';
import { formatDayOfMonth, formatMonth } from '../../finance/lib/format.js';
import { decimalToCents } from '../../finance/lib/money.js';
import type { Cents } from '../../finance/lib/money.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { toNumber } from '../../lib/chart/scale.js';
import { useResource } from '../../lib/use_resource.js';

/**
 * VGR-03 · O Fluxo do mês da Visão geral · Tudo, na forma da prancha 1.1: a
 * cascata Receitas − Despesas − Aportes = Saldo do mês, em
 * **Lançado** e **Previsto no mês** (o mês inteiro como se fecharia: lançado mais
 * o que falta lançar), com uma barra por linha e a taxa de aporte no rodapé.
 * Todos os números vêm do livro do servidor (RN-U1, RN-U16): a tela só os mostra.
 * Provento e resgate não entram na cascata.
 */

type Totals = BookResponse['totals'];

type CascadeLine = {
  readonly key: string;
  readonly label: string;
  readonly tipo?: string;
  readonly posted: string;
  readonly projected: string;
  readonly bar: string;
  readonly strong?: boolean;
};

const isZero = (value: string): boolean => /^-?0+(\.0+)?$/.test(value);

const cascadeLines = (totals: Totals): readonly CascadeLine[] => [
  {
    key: 'receitas',
    label: 'Receitas',
    tipo: 'RECEITA',
    posted: totals.receitas,
    projected: totals.projetado.receitas,
    bar: 'bg-positive',
  },
  {
    key: 'despesas',
    label: '− Despesas',
    tipo: 'DESPESA',
    posted: totals.despesas,
    projected: totals.projetado.despesas,
    bar: 'bg-ink-3',
  },
  {
    key: 'aportes',
    label: '− Aportes · despesa financeira',
    tipo: 'APORTE',
    posted: totals.aportes,
    projected: totals.projetado.aportes,
    bar: 'bg-accent',
  },
  // O aporte vindo de fora do app entra na carteira sem sair das contas: volta
  // para o saldo, e a cascata continua fechando.
  ...(isZero(totals.aportes_de_fora) && isZero(totals.projetado.aportes_de_fora)
    ? []
    : [
        {
          key: 'fora',
          label: '+ Aportes de fora do app · não saem das contas',
          posted: totals.aportes_de_fora,
          projected: totals.projetado.aportes_de_fora,
          bar: 'bg-line-2',
        },
      ]),
  {
    key: 'saldo',
    label: '= Saldo do mês',
    posted: totals.saldo_do_mes,
    projected: totals.projetado.saldo_do_mes,
    bar: 'bg-ink',
    strong: true,
  },
];

/** A largura da barra é geometria: o previsto da linha sobre a receita prevista do mês. */
const barWidth = (value: string, whole: string): number => {
  const part = toNumber(value);
  const all = toNumber(whole);
  if (part === null || all === null || all <= 0) return 0;
  return Math.max(0, Math.min(100, (part / all) * 100));
};

const cents = (value: string): Cents => (decimalToCents(value) ?? 0) as Cents;

const percent = (value: string | null): string =>
  value === null ? '—' : `${value.replace('.', ',')}%`;

export const FluxoDoMesPanel = ({
  today,
}: {
  readonly today: IsoDate;
}): React.ReactElement => {
  const month = today.slice(0, 7);
  const book = useResource((signal) => fetchBook({ month, limit: 1 }, signal), [month]);
  const state = book.state;

  const link = (tipo: string, situacao?: string): string =>
    financeRoutes.entries(
      `tipo=${tipo}${situacao === undefined ? '' : `&situacao=${situacao}`}`,
    );

  let body: React.ReactElement;
  if (state.kind === 'loading') {
    body = (
      <SkeletonRegion label="Carregando a cascata do mês">
        <SkeletonTable rows={5} columns={4} />
      </SkeletonRegion>
    );
  } else if (state.kind !== 'ready') {
    body = (
      <PanelError
        title="Não foi possível carregar a cascata do mês"
        onRetry={book.reload}
      />
    );
  } else {
    const { totals } = state.value;
    const cascadeRow = (line: CascadeLine): React.ReactElement => (
      <tr
        key={line.key}
        className={
          line.strong === true
            ? 'border-t border-line-2 bg-panel-2 font-semibold'
            : 'border-t border-line'
        }
      >
        <th
          scope="row"
          className={`py-[var(--row-pad)] pl-3 text-left font-[inherit] ${line.strong === true ? 'font-semibold' : 'font-normal'}`}
        >
          {line.label}
        </th>
        <td className="tabular px-3 py-[var(--row-pad)] text-right">
          {line.tipo === undefined ? (
            <Amount cents={cents(line.posted)} />
          ) : (
            <Link
              to={link(line.tipo, 'lancado')}
              className="cursor-pointer hover:text-accent hover:underline"
            >
              <Amount cents={cents(line.posted)} />
            </Link>
          )}
        </td>
        <td className="tabular px-3 py-[var(--row-pad)] text-right">
          {line.tipo === undefined ? (
            <Amount cents={cents(line.projected)} />
          ) : (
            <Link
              to={link(line.tipo)}
              className="cursor-pointer hover:text-accent hover:underline"
            >
              <Amount cents={cents(line.projected)} />
            </Link>
          )}
        </td>
        <td className="w-40 px-3 py-[var(--row-pad)]" aria-hidden="true">
          <span className="block h-1 w-full overflow-hidden rounded-full bg-line">
            <span
              className={`block h-full rounded-full ${line.bar}`}
              style={{
                width: `${barWidth(line.projected, totals.projetado.receitas)}%`,
              }}
            />
          </span>
        </td>
      </tr>
    );
    body = (
      <>
        <FinTable caption="Cascata do mês" fill>
          <THead>
            <Th>Cascata</Th>
            <Th align="right">Lançado</Th>
            <Th align="right">Previsto no mês</Th>
            <Th>
              <span className="sr-only">Proporção da receita prevista</span>
            </Th>
          </THead>
          <tbody>
            {cascadeLines(totals)
              .filter((line) => line.strong !== true)
              .map((line) => cascadeRow(line))}
            <tr className="border-t border-line text-[0.8125rem]">
              <th
                scope="row"
                className="py-3 pl-3 text-left font-[inherit] font-normal text-ink-2"
              >
                Taxa de aporte <span className="text-ink-3">(aportes ÷ receitas)</span>
              </th>
              <td colSpan={3} className="tabular px-3 py-3 text-right font-semibold">
                {percent(totals.taxa_aporte.lancada)} lançada ·{' '}
                {percent(totals.taxa_aporte.prevista)} prevista
              </td>
            </tr>
            <FillRow colSpan={4} />
            {cascadeLines(totals)
              .filter((line) => line.strong === true)
              .map((line) => cascadeRow(line))}
          </tbody>
        </FinTable>
      </>
    );
  }

  return (
    <Panel
      title="Fluxo do mês"
      action={
        <span className="text-xs text-ink-3">
          {formatMonth(today)} · {formatDayOfMonth(today)}
        </span>
      }
      className="flex flex-col"
    >
      {body}
    </Panel>
  );
};
