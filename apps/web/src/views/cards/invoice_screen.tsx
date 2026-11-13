import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { fetchAccountNames } from '../../api/book.js';
import { fetchInvoice } from '../../api/invoice.js';
import type { InvoiceBlock, InvoiceResource } from '../../api/invoice.js';
import { fetchCategories } from '../../api/ledger_write.js';
import { usePreferences } from '../../components/preferences.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { downloadCsv } from '../../finance/lib/csv.js';
import {
  invoiceStatusLabel,
  monthLabel,
  paidNote,
  shortDate,
} from '../../lib/cards_view.js';
import { formatMoney } from '../../lib/format.js';
import {
  BLOCKS,
  exportInvoiceRows,
  filterInvoiceLines,
  LINE_TYPE_LABEL,
  neighbours,
  subtotal,
} from '../../lib/invoice_view.js';

/**
 * CRT-04 e CRT-05 · A fatura de um cartão: o extrato completo em quatro blocos
 * (compras, parcelas, créditos, encargos), cada um com subtotal, e o total da
 * fatura. Busca e filtro por tipo só escondem linhas: o total não muda, e o
 * subtotal filtrado aparece ao lado. O mês e a busca moram na URL.
 */
export const InvoiceScreen = (): React.ReactElement => {
  const { id = '', month = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { hidden } = usePreferences();
  const [data, setData] = useState<InvoiceResource | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [categories, setCategories] = useState<ReadonlyMap<string, string>>(new Map());
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  const query = params.get('q') ?? '';
  const types = (params.get('tipo') ?? '')
    .split(',')
    .filter((t): t is InvoiceBlock => t in LINE_TYPE_LABEL);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    fetchInvoice(id, month, controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    fetchAccountNames(controller.signal)
      .then(setNames)
      .catch(() => undefined);
    fetchCategories(controller.signal)
      .then((list) => setCategories(new Map(list.map((c) => [c.id, c.name]))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [id, month, reload]);

  const categoryName = (cid: string | null): string =>
    cid === null ? '' : (categories.get(cid) ?? '');
  const visible = useMemo(
    () =>
      data === null ? [] : filterInvoiceLines(data.lines, query, types, categoryName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, query, params, categories],
  );

  if (failed) {
    return (
      <PanelError
        title="Não foi possível carregar a fatura"
        onRetry={() => setReload((n) => n + 1)}
      />
    );
  }
  if (data === null) return <TableScreenSkeleton label="Carregando fatura" columns={5} />;

  const money = (value: string): string => formatMoney(value, { hidden }).text;
  const accountName = (aid: string): string => names.get(aid) ?? 'conta';
  const { summary, card } = data;
  const nav = neighbours(data.months, month);
  const goTo = (m: string): void => {
    void navigate(
      `/cartoes-novo/${card.id}/faturas/${m}${params.toString() === '' ? '' : `?${params}`}`,
    );
  };
  const set = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const filtered = query !== '' || types.length > 0;
  const paid = summary.status === 'paga' ? paidNote(data.payments, accountName) : null;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title={`Fatura ${monthLabel(month)}`}
        crumbs={[
          { label: 'Cartões', to: '/cartoes-novo' },
          { label: card.name, to: `/cartoes-novo/${card.id}` },
          { label: monthLabel(month) },
        ]}
        subtitle={
          <>
            compras de {shortDate(data.period.from)} a {shortDate(data.period.to)} · fecha
            em {shortDate(summary.closing)} · vence em {shortDate(summary.due)} · paga com{' '}
            {accountName(card.pay_account_id)}
          </>
        }
        extra={
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Fatura anterior"
              disabled={nav.prev === null}
              className="cursor-pointer rounded-field border border-line px-2 py-1 disabled:cursor-not-allowed"
              onClick={() => nav.prev !== null && goTo(nav.prev)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' && nav.prev !== null) goTo(nav.prev);
                if (e.key === 'ArrowRight' && nav.next !== null) goTo(nav.next);
              }}
            >
              ←
            </button>
            <span
              role="group"
              tabIndex={0}
              aria-label="Fatura"
              className="min-w-20 text-center text-sm"
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' && nav.prev !== null) goTo(nav.prev);
                if (e.key === 'ArrowRight' && nav.next !== null) goTo(nav.next);
              }}
            >
              Fatura: {monthLabel(month)}
            </span>
            <button
              type="button"
              aria-label="Próxima fatura"
              disabled={nav.next === null}
              className="cursor-pointer rounded-field border border-line px-2 py-1 disabled:cursor-not-allowed"
              onClick={() => nav.next !== null && goTo(nav.next)}
            >
              →
            </button>
          </div>
        }
      />
      <p className="text-sm">
        <span
          className={`rounded-full border border-line px-2 py-0.5 text-xs ${summary.overdue ? 'border-negative font-medium text-negative' : ''}`}
        >
          {invoiceStatusLabel(summary.status, summary.overdue)}
        </span>
        {paid !== null && <span className="ml-2 text-ink-3">{paid}</span>}
        {summary.status === 'prevista' && (
          <span className="ml-2 text-ink-3">
            Só parcelas e recorrentes já previstos entram nesta fatura.
          </span>
        )}
      </p>
      <div role="search" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Buscar na fatura"
          placeholder="Buscar descrição ou categoria"
          value={query}
          onChange={(e) => set('q', e.target.value)}
        />
        {BLOCKS.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={types.includes(b.id)}
            className="cursor-pointer rounded-full border border-line px-2 py-0.5 text-xs aria-pressed:bg-panel-2"
            onClick={() =>
              set(
                'tipo',
                (types.includes(b.id)
                  ? types.filter((t) => t !== b.id)
                  : [...types, b.id]
                ).join(','),
              )
            }
          >
            {LINE_TYPE_LABEL[b.id]}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto cursor-pointer rounded-field border border-line px-3 py-1.5 text-sm"
          onClick={() =>
            downloadCsv(
              `fatura-${card.name}-${month}.csv`,
              exportInvoiceRows(data.lines, categoryName),
            )
          }
        >
          Exportar
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-label text-ink-3 uppercase">
            <th scope="col">Data</th>
            <th scope="col">Descrição</th>
            <th scope="col" className="max-md:hidden">
              Categoria
            </th>
            <th scope="col" className="text-right">
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {BLOCKS.map((block) => {
            const lines = visible.filter((l) => l.block === block.id);
            return (
              <Fragment key={block.id}>
                <tr className="bg-panel-2 font-medium">
                  <th scope="rowgroup" colSpan={3} className="text-left">
                    {block.label}
                  </th>
                  <td className="tabular text-right">
                    {money(subtotal(lines))}
                    {filtered && <span className="sr-only"> (filtrado)</span>}
                  </td>
                </tr>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-xs text-ink-3">
                      {block.empty}
                    </td>
                  </tr>
                ) : (
                  lines.map((l) => (
                    <tr key={l.id}>
                      <td>{shortDate(l.date)}</td>
                      <td>
                        {l.origin === 'entry' ? (
                          <Link
                            className="underline"
                            to={`/livro?q=${encodeURIComponent(l.description)}`}
                          >
                            {l.description}
                          </Link>
                        ) : (
                          l.description
                        )}
                        {l.installment !== null && (
                          <span className="ml-1 text-xs text-ink-3">
                            {l.installment.no}/{l.installment.total}
                          </span>
                        )}
                        {l.forecast && (
                          <span className="ml-1 text-xs text-ink-3">prevista</span>
                        )}
                      </td>
                      <td className="max-md:hidden">
                        {categoryName(l.category_id) || '—'}
                      </td>
                      <td className="tabular text-right">
                        {l.block === 'creditos'
                          ? `− ${money(l.amount)}`
                          : money(l.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <th scope="row" colSpan={3} className="text-left">
              Total da fatura
            </th>
            <td className="tabular text-right">{money(data.totals.total)}</td>
          </tr>
          {filtered && (
            <tr>
              <th scope="row" colSpan={3} className="text-left font-normal">
                Subtotal filtrado
              </th>
              <td className="tabular text-right">{money(subtotal(visible))}</td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
};
