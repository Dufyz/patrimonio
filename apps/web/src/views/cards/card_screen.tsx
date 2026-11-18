import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { fetchAccountNames } from '../../api/book.js';
import { fetchCardDetail } from '../../api/card_detail.js';
import { fetchCardsOverview } from '../../api/cards_overview.js';
import type { CardRowResource } from '../../api/cards_overview.js';
import type { CardDetailResource } from '../../api/card_detail.js';
import { setCardArchived } from '../../api/card_write.js';
import { ApiError } from '../../api/client.js';
import { AlertModal } from '../../components/overlay.js';
import { newAttemptKey } from '../../lib/entry.js';
import { CardModal } from './card_modal.js';
import { usePreferences } from '../../components/preferences.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { EmptyPanel, PanelError } from '../../finance/components/states.js';
import { Panel } from '../../components/primitives.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { StatStrip } from '../../finance/components/stat_strip.js';
import { StatusTag } from '../../finance/components/tags.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { NewEntryModal } from '../ledger/new_entry_modal.js';
import { HeaderSelect } from './header_select.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
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
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [cards, setCards] = useState<readonly CardRowResource[]>([]);
  const [allDue, setAllDue] = useState('0');
  const [archiveError, setArchiveError] = useState<string | null>(null);

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
    fetchCardsOverview(controller.signal)
      .then((overview) => {
        setCards(overview.cards);
        setAllDue(overview.wealth.total_devido);
      })
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
  const bare = (value: string): string => formatMoney(value, { hidden, bare: true }).text;
  const accountName = (accountId: string): string => names.get(accountId) ?? 'conta';
  const { card } = data.summary;
  const dm = (iso: string): string => `${iso.slice(8)}/${iso.slice(5, 7)}`;
  const fullMonth = (key: string): string =>
    new Date(
      Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1),
    ).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  const real = data.invoices.filter((i) => i.status !== 'prevista');
  const shown = showAll ? real : real.slice(0, 6);
  const openInvoice = data.invoices.find((i) => i.month === data.open_month);
  const closedOwed = data.invoices.filter(
    (i) => (i.status === 'fechada' || i.status === 'parcial') && !isZero(i.remaining),
  );
  const firstClosed = closedOwed.at(-1);
  const widest = Math.max(1, ...real.map((i) => Number(i.total)));
  const futureNames = [...new Set(data.future_parts.map((p) => p.description))];
  const futureCaption =
    data.future_parts.length === 0
      ? 'nenhuma parcela futura'
      : futureNames.length === 1
        ? `${data.future_parts.length} × ${money(data.future_parts[0]?.amount ?? '0')} · ${futureNames[0]?.toLowerCase()}`
        : `${data.future_parts.length} parcelas em ${futureNames.length} compras`;
  const options = [
    { id: 'todos', label: 'Todos os cartões', amount: money(allDue) },
    ...cards.map((c) => ({
      id: c.card.id,
      label: c.card.name,
      amount: money(c.debt.total),
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title={card.name}
        subtitle={`Final ${card.last4} · fecha dia ${card.closing_day} · vence dia ${card.due_day} · paga com ${accountName(card.pay_account_id)}`}
        primary={{ label: 'Movimentação', onClick: () => setLaunching(true) }}
        extra={
          <>
            <button
              type="button"
              className="cursor-pointer rounded-control border border-line-2 bg-panel px-3 py-1.5 text-[0.78125rem] hover:bg-panel-2"
              onClick={() => setEditing(true)}
            >
              Editar cartão
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-control border border-line-2 bg-panel px-3 py-1.5 text-[0.78125rem] hover:bg-panel-2"
              onClick={() => {
                setArchiveError(null);
                setArchiving(true);
              }}
            >
              Arquivar
            </button>
            <HeaderSelect
              label="Cartão"
              current={card.name}
              selected={card.id}
              footer="Escolha um cartão para ver só as faturas dele."
              options={options}
              onSelect={(value) =>
                navigate(
                  value === 'todos' ? financeRoutes.cards() : financeRoutes.card(value),
                )
              }
            />
          </>
        }
      />
      <StatStrip
        label="Resumo do cartão"
        cells={[
          {
            id: 'limite',
            label: 'Limite disponível',
            value: money(data.limit.available),
            caption: `de ${money(card.limit_amount)} · ${data.limit.percent}% usado`,
          },
          {
            id: 'aberta',
            label: 'Fatura aberta',
            value: money(openInvoice?.total ?? '0'),
            caption:
              openInvoice === undefined
                ? 'sem fatura aberta'
                : `fecha em ${dm(openInvoice.closing)} · vence ${dm(openInvoice.due)}`,
          },
          {
            id: 'fechada',
            label: 'Fechada a pagar',
            value: money(firstClosed?.remaining ?? '0'),
            caption:
              firstClosed === undefined
                ? 'nenhuma fatura fechada'
                : `vence ${dm(firstClosed.due)} · pagamento previsto`,
          },
          {
            id: 'parcelas',
            label: 'Parcelas futuras',
            value: money(data.future_total),
            caption: futureCaption,
          },
        ]}
      />

      {editing && (
        <CardModal
          editing={{
            id: card.id,
            draft: {
              name: card.name,
              last4: card.last4,
              limit: card.limit_amount.replace('.', ','),
              closingDay: String(card.closing_day),
              dueDay: String(card.due_day),
              payAccountId: card.pay_account_id,
            },
          }}
          accounts={[...names].map(([aid, name]) => ({ id: aid, name }))}
          existingNames={[]}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setEditing(false)}
        />
      )}
      {launching && (
        <NewEntryModal
          today={data.as_of}
          accounts={[...names].map(([aid, name]) => ({ id: aid, name }))}
          context={{ cardId: card.id }}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setLaunching(false)}
        />
      )}
      {archiving && (
        <AlertModal
          icon="archive"
          open
          title={`Arquivar ${card.name}?`}
          message={
            <>
              O cartão sai das listas e das opções de origem; as faturas antigas continuam
              disponíveis.
              {archiveError !== null && (
                <span role="alert" className="mt-2 block text-negative">
                  {archiveError}
                </span>
              )}
            </>
          }
          cancelLabel="Cancelar"
          confirmLabel="Arquivar"
          onCancel={() => setArchiving(false)}
          onConfirm={() => {
            void setCardArchived(card.id, true, newAttemptKey())
              .then(() => navigate('/cartoes'))
              .catch((error: unknown) =>
                setArchiveError(
                  error instanceof ApiError
                    ? error.message
                    : 'Não foi possível arquivar.',
                ),
              );
          }}
        />
      )}

      <Panel
        title="Faturas do cartão"
        action={
          <span className="text-xs text-ink-3">
            {showAll ? 'todas as faturas' : 'as seis mais recentes'}
          </span>
        }
      >
        <FinTable caption="Faturas do cartão">
          <THead>
            <Th>Fatura</Th>
            <Th className="max-md:hidden">Período</Th>
            <Th>Vence</Th>
            <Th className="max-lg:hidden">
              <span className="sr-only">Peso</span>
            </Th>
            <Th align="right">Valor (R$)</Th>
            <Th>Situação</Th>
            <Th>
              <span className="sr-only">Abrir</span>
            </Th>
          </THead>
          <tbody>
            {shown.map((inv) => {
              const href = financeRoutes.card(card.id, inv.month);
              const isOpen = inv.status === 'aberta';
              const paid = inv.status === 'paga';
              const lastPayment = inv.payments
                .map((p) => p.date)
                .sort()
                .at(-1);
              return (
                <tr
                  key={inv.month}
                  tabIndex={0}
                  className={`cursor-pointer border-t border-line hover:bg-panel-2 ${
                    inv.status === 'fechada' || inv.status === 'parcial'
                      ? 'planned-stripes'
                      : ''
                  }`}
                  onClick={() => navigate(href)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(href)}
                >
                  <th
                    scope="row"
                    className="px-3 py-[var(--row-pad)] text-left font-semibold"
                  >
                    Fatura de {fullMonth(inv.month)}
                  </th>
                  <td className="tabular px-3 py-[var(--row-pad)] text-ink-2 max-md:hidden">
                    {dm(inv.from)} – {dm(inv.to)}
                  </td>
                  <td className="tabular px-3 py-[var(--row-pad)]">{dm(inv.due)}</td>
                  <td className="px-3 py-[var(--row-pad)] max-lg:hidden">
                    <span
                      aria-hidden="true"
                      className="relative block h-1.5 w-32 overflow-hidden rounded-full bg-line"
                    >
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-ink"
                        style={{ width: `${(Number(inv.total) / widest) * 100}%` }}
                      />
                    </span>
                  </td>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right font-semibold">
                    {money(inv.total)}
                  </td>
                  <td className="px-3 py-[var(--row-pad)]">
                    <StatusTag
                      status={isOpen ? 'aberta' : paid ? 'paga' : 'fechada'}
                      label={
                        isOpen
                          ? 'Aberta'
                          : paid
                            ? `Paga em ${lastPayment === undefined ? '—' : dm(lastPayment)}`
                            : inv.overdue
                              ? 'Vencida'
                              : 'A pagar'
                      }
                    />
                  </td>
                  <td
                    className="px-3 py-[var(--row-pad)] text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link to={href} className="text-accent hover:underline">
                      Abrir fatura
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </FinTable>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[0.8125rem] text-ink-2">
          <span>
            {data.average_closed === null ? (
              'Ainda não há fatura fechada.'
            ) : (
              <>
                Média das cinco últimas faturas fechadas:{' '}
                <span className="tabular font-semibold text-ink">
                  {money(data.average_closed)}
                </span>
              </>
            )}
          </span>
          {real.length > 6 ? (
            <button
              type="button"
              className="cursor-pointer text-accent hover:underline"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Ver só as recentes' : 'Ver mais antigas'}
            </button>
          ) : null}
        </footer>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Por categoria"
          action={
            <span className="text-xs text-ink-3">
              fatura aberta · {fullMonth(data.open_month)}
            </span>
          }
        >
          {data.open_invoice_categories.length === 0 ? (
            <EmptyPanel message="A fatura aberta ainda não tem compras." />
          ) : (
            <FinTable caption="Fatura aberta por categoria">
              <THead>
                <Th>Categoria</Th>
                <Th align="right">Valor</Th>
                <Th align="right">Peso</Th>
              </THead>
              <tbody>
                {data.open_invoice_categories.map((row) => (
                  <tr key={row.category_id ?? 'sem'} className="border-t border-line">
                    <td className="px-3 py-[var(--row-pad)]">{row.name}</td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right font-semibold">
                      {money(row.amount)}
                    </td>
                    <td className="px-3 py-[var(--row-pad)]">
                      <span className="flex items-center justify-end gap-3">
                        <span
                          aria-hidden="true"
                          className="relative block h-1.5 w-24 overflow-hidden rounded-full bg-line"
                        >
                          <span
                            className="absolute inset-y-0 left-0 rounded-full bg-ink-3"
                            style={{ width: `${row.percent}%` }}
                          />
                        </span>
                        <span className="tabular w-10 text-right">{row.percent}%</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-semibold">
                  <th scope="row" className="px-3 py-[var(--row-pad)] text-left">
                    Total
                  </th>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right">
                    {money(openInvoice?.total ?? '0')}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </FinTable>
          )}
        </Panel>
        <Panel
          title="Parcelas futuras"
          action={
            <span className="text-xs text-ink-3">
              {futureNames.length === 1 && data.future_parts[0] !== undefined
                ? `${futureNames[0]?.toLowerCase()} · ${data.future_parts[0].total}x de ${money(data.future_parts[0].amount)}`
                : 'o que ainda vai cair nas próximas faturas'}
            </span>
          }
        >
          {data.future_parts.length === 0 ? (
            <EmptyPanel message="Nenhuma parcela futura." />
          ) : (
            <FinTable caption="Parcelas futuras">
              <THead>
                <Th>Cai na</Th>
                <Th align="right">Parcela</Th>
                <Th align="right">Valor (R$)</Th>
              </THead>
              <tbody>
                {data.future_parts.map((part) => (
                  <tr
                    key={`${part.month}:${part.description}`}
                    className="border-t border-line"
                  >
                    <td className="px-3 py-[var(--row-pad)]">
                      Fatura de {fullMonth(part.month)}
                      {futureNames.length > 1 ? (
                        <span className="block text-xs text-ink-3">
                          {part.description}
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right text-ink-2">
                      {part.no}/{part.total}
                    </td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right">
                      {bare(part.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-semibold">
                  <th
                    scope="row"
                    colSpan={2}
                    className="px-3 py-[var(--row-pad)] text-left"
                  >
                    Total a pagar
                  </th>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right">
                    {money(data.future_total)}
                  </td>
                </tr>
              </tfoot>
            </FinTable>
          )}
        </Panel>
      </div>
    </div>
  );
};

const isZero = (value: string): boolean => /^-?0+([.,]0+)?$/.test(value);
