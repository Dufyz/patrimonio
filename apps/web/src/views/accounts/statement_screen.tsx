import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import { fetchAccountStatement } from '../../api/statement_view.js';
import type { AccountStatementResource } from '../../api/statement_view.js';
import { fetchCategories } from '../../api/ledger_write.js';
import { usePreferences } from '../../components/preferences.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { formatMoney } from '../../lib/format.js';
import {
  dayMonth,
  newestFirst,
  statementCloses,
  typeLabel,
} from '../../lib/statement_view.js';

/**
 * CTA-02 · Extrato: o que entrou e saiu de uma conta, do mais novo ao mais
 * antigo, com o saldo após cada linha. Se o saldo inicial + entradas − saídas
 * não fechar no saldo final, os números somem e o erro aparece no lugar.
 */
export const AccountStatementScreen = (): React.ReactElement => {
  const { id = '' } = useParams();
  const { hidden } = usePreferences();
  const [data, setData] = useState<AccountStatementResource | null>(null);
  const [categories, setCategories] = useState<ReadonlyMap<string, string>>(new Map());
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    fetchAccountStatement(id, {}, controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    fetchCategories(controller.signal)
      .then((list) => setCategories(new Map(list.map((c) => [c.id, c.name]))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [id, reload]);

  const lines = useMemo(() => (data === null ? [] : newestFirst(data.lines)), [data]);

  if (failed) {
    return (
      <PanelError
        title="Não foi possível carregar o extrato"
        onRetry={() => {
          setFailed(false);
          setReload((n) => n + 1);
        }}
      />
    );
  }
  if (data === null)
    return <TableScreenSkeleton label="Carregando extrato" columns={6} />;

  const money = (value: string): string => formatMoney(value, { hidden }).text;
  const closes = statementCloses(data);
  const name = data.account.institution
    ? `${data.account.institution}`
    : data.account.name;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title={name}
        crumbs={[{ label: 'Contas', to: financeRoutes.accounts() }, { label: name }]}
        subtitle={
          closes ? (
            <>
              {money(data.closing)} · saldo de {dayMonth(data.range.from)}{' '}
              {money(data.opening)} · entrou {money(data.entered)} · saiu{' '}
              {money(data.left)}
            </>
          ) : (
            'Saldo indisponível'
          )
        }
      />
      {!closes && (
        <p role="alert" className="text-sm text-negative">
          O extrato não fecha: saldo inicial + entradas − saídas difere do saldo final. Os
          valores foram ocultados até a inconsistência ser corrigida.
        </p>
      )}
      <p className="text-sm">
        <Link
          className="underline"
          to={financeRoutes.entries(`conta=${encodeURIComponent(data.account.id)}`)}
        >
          Ver em Lançamentos com filtro desta conta
        </Link>
      </p>
      {lines.length === 0 ? (
        <p className="text-sm text-ink-3">Nenhum movimento neste período.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-label text-ink-3 uppercase">
              <th scope="col">Data</th>
              <th scope="col">Descrição</th>
              <th scope="col" className="max-md:hidden">
                Tipo
              </th>
              <th scope="col" className="max-lg:hidden">
                Categoria
              </th>
              <th scope="col" className="text-right">
                Valor
              </th>
              <th scope="col" className="text-right">
                Saldo após
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td>{dayMonth(line.date)}</td>
                <td>
                  {line.description}
                  {line.note !== null && (
                    <span className="block text-xs text-ink-3">{line.note}</span>
                  )}
                </td>
                <td className="max-md:hidden">{typeLabel(line)}</td>
                <td className="max-lg:hidden">
                  {line.category_id === null
                    ? '—'
                    : (categories.get(line.category_id) ?? '—')}
                </td>
                <td className="tabular text-right">
                  {closes ? money(line.amount) : '—'}
                </td>
                <td className="tabular text-right">
                  {closes ? money(line.balance_after) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
