import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { fetchAccountNames } from '../../api/book.js';
import { fetchCardDetail } from '../../api/card_detail.js';
import type { CardDetailResource } from '../../api/card_detail.js';
import { usePreferences } from '../../components/preferences.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import {
  invoiceStatusLabel,
  monthLabel,
  paidNote,
  shortDate,
} from '../../lib/cards_view.js';
import { formatMoney } from '../../lib/format.js';

/**
 * CRT-03 · Um cartão: limite, faturas por mês, parcelamentos em andamento e os
 * pagamentos previstos que saem da conta pagadora.
 */
export const CardScreen = (): React.ReactElement => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hidden } = usePreferences();
  const [data, setData] = useState<CardDetailResource | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    fetchCardDetail(id, controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    fetchAccountNames(controller.signal)
      .then(setNames)
      .catch(() => undefined);
    return () => controller.abort();
  }, [id, reload]);

  if (failed) {
    return (
      <PanelError
        title="Não foi possível carregar o cartão"
        onRetry={() => {
          setFailed(false);
          setReload((n) => n + 1);
        }}
      />
    );
  }
  if (data === null) return <TableScreenSkeleton label="Carregando cartão" columns={5} />;

  const money = (value: string): string => formatMoney(value, { hidden }).text;
  const accountName = (accountId: string): string => names.get(accountId) ?? 'conta';
  const { card } = data.summary;

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        title={card.name}
        crumbs={[{ label: 'Cartões', to: '/cartoes-novo' }, { label: card.name }]}
        subtitle={`final ${card.last4} · paga pela ${accountName(card.pay_account_id)} · limite ${money(card.limit_amount)} · usado ${data.summary.used_percent}% · disponível ${money(data.summary.available)}`}
        extra={
          <label className="text-sm">
            <span className="sr-only">Cartão</span>
            <select
              aria-label="Cartão"
              className="cursor-pointer rounded-field border border-line px-2 py-1.5"
              value={card.id}
              onChange={(e) =>
                navigate(
                  e.target.value === ''
                    ? '/cartoes-novo'
                    : `/cartoes-novo/${e.target.value}`,
                )
              }
            >
              <option value="">Cartão: Todos</option>
              <option value={card.id}>Cartão: {card.name}</option>
            </select>
          </label>
        }
      />

      <section aria-label="Faturas" className="flex flex-col gap-2">
        <h2 className="text-label text-ink-3 uppercase">Faturas</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-label text-ink-3 uppercase">
              <th scope="col">Fatura</th>
              <th scope="col" className="max-md:hidden">
                Compras de
              </th>
              <th scope="col">Vence</th>
              <th scope="col" className="text-right">
                Total
              </th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((inv) => {
              const note =
                inv.status === 'paga' ? paidNote(inv.payments, accountName) : null;
              const href = `/cartoes-novo/${card.id}/faturas/${inv.month}`;
              return (
                <tr
                  key={inv.month}
                  tabIndex={0}
                  className="cursor-pointer hover:bg-panel-2"
                  onClick={() => navigate(href)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(href)}
                >
                  <th scope="row" className="text-left font-normal">
                    <Link
                      to={href}
                      className="no-underline"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      {monthLabel(inv.month)}
                    </Link>
                  </th>
                  <td className="max-md:hidden">
                    {shortDate(inv.from)} a {shortDate(inv.to)}
                  </td>
                  <td>{shortDate(inv.due)}</td>
                  <td className="tabular text-right">{money(inv.total)}</td>
                  <td>
                    <span className={inv.overdue ? 'font-medium text-negative' : ''}>
                      {invoiceStatusLabel(inv.status, inv.overdue)}
                    </span>
                    {note !== null && (
                      <span className="block text-xs text-ink-3">{note}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-label="Parcelamentos" className="flex flex-col gap-2">
        <h2 className="text-label text-ink-3 uppercase">Parcelamentos</h2>
        {data.installments.length === 0 ? (
          <p className="text-sm text-ink-3">Nenhuma compra parcelada em andamento.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-label text-ink-3 uppercase">
                <th scope="col">Compra</th>
                <th scope="col">Parcela</th>
                <th scope="col" className="text-right">
                  Valor da parcela
                </th>
                <th scope="col" className="text-right">
                  Restante
                </th>
              </tr>
            </thead>
            <tbody>
              {data.installments.map((plan) => (
                <tr key={`${plan.description}|${plan.origin}|${plan.total}`}>
                  <th scope="row" className="text-left font-normal">
                    {plan.description}
                    <span className="block text-xs text-ink-3">
                      em {shortDate(plan.origin)}
                    </span>
                  </th>
                  <td className="tabular">
                    {plan.current}/{plan.total}
                  </td>
                  <td className="tabular text-right">{money(plan.amount)}</td>
                  <td className="tabular text-right">{money(plan.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Pagamentos previstos" className="flex flex-col gap-2">
        <h2 className="text-label text-ink-3 uppercase">Pagamentos previstos</h2>
        {data.planned_payments.length === 0 ? (
          <p className="text-sm text-ink-3">Nenhum pagamento previsto.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-label text-ink-3 uppercase">
                <th scope="col">Vence</th>
                <th scope="col">Fatura</th>
                <th scope="col">Sai de</th>
                <th scope="col" className="text-right">
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {data.planned_payments.map((p) => (
                <tr key={p.month}>
                  <td>{shortDate(p.due)}</td>
                  <td>{monthLabel(p.month)}</td>
                  <td>{accountName(p.account_id)}</td>
                  <td className="tabular text-right">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};
