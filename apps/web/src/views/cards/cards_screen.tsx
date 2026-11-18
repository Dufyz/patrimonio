import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { fetchAccountNames } from '../../api/book.js';
import { fetchCardsOverview } from '../../api/cards_overview.js';
import type { CardRowResource, CardsResource } from '../../api/cards_overview.js';
import { usePreferences } from '../../components/preferences.js';
import { Panel } from '../../components/primitives.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { KindTag, StatusTag } from '../../finance/components/tags.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { Arrow } from '../ledger/ledger_parts.js';
import { HeaderSelect } from './header_select.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { totalLink } from '../../lib/total_links.js';
import { StatStrip } from '../../finance/components/stat_strip.js';
import { EmptyPanel, PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { formatMoney } from '../../lib/format.js';
import { CardModal } from './card_modal.js';
import { NewEntryModal } from '../ledger/new_entry_modal.js';

/**
 * CRT-01 e CRT-02 · Todos os cartões: quanto vence, quanto do limite foi usado e
 * quanto fica livre depois das faturas. Sem sparklines; cada linha abre o cartão.
 */
const dayMonth = (iso: string): string => `${iso.slice(8)}/${iso.slice(5, 7)}`;

export const CardsScreen = (): React.ReactElement => {
  const { hidden } = usePreferences();
  const navigate = useNavigate();
  const [data, setData] = useState<CardsResource | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [paying, setPaying] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchCardsOverview(controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    fetchAccountNames(controller.signal)
      .then(setNames)
      .catch(() => undefined);
    return () => controller.abort();
  }, [reload]);

  if (failed) {
    return (
      <PanelError
        title="Não foi possível carregar os cartões"
        onRetry={() => {
          setFailed(false);
          setReload((n) => n + 1);
        }}
      />
    );
  }
  if (data === null)
    return <TableScreenSkeleton label="Carregando cartões" columns={7} />;

  const money = (value: string): string => formatMoney(value, { hidden }).text;
  const w = data.wealth;
  const sum = data.summary;
  const cardName = (id: string): string =>
    data.cards.find((c) => c.card.id === id)?.card.name ?? 'cartão';
  const payerName = (id: string): string => names.get(id) ?? 'conta';
  const cardTotal = (row: CardRowResource): string => money(row.debt.total);
  const monthNames = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  const duesText = (dues: readonly string[]): string => {
    const labels = [
      ...new Set(dues.map((d) => monthNames[Number(d.slice(5, 7)) - 1] ?? '')),
    ];
    return labels.length === 0
      ? 'nenhuma'
      : `vencem em ${labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`}`;
  };
  const isoToday = data.as_of;
  const todayText = `${isoToday.slice(8)}/${isoToday.slice(5, 7)}/${isoToday.slice(0, 4)}`;
  const plural = (n: number, one: string, many: string): string =>
    `${n} ${n === 1 ? one : many}`;
  /** Fechadas a pagar primeiro, depois a aberta: o que se deve em cada cartão. */
  const owedOf = (row: CardRowResource) =>
    [...row.invoices]
      .filter((i) => Number(i.remaining) > 0 && i.status !== 'prevista')
      .sort((a, b) => {
        const rank = (status: string): number => (status === 'aberta' ? 1 : 0);
        return rank(a.status) - rank(b.status) || a.due.localeCompare(b.due);
      });

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Cartões"
        primary={{ label: 'Movimentação', onClick: () => setLaunching(true) }}
        subtitle={`Todos os cartões · faturas e limites · hoje, ${todayText}`}
        extra={
          <>
            <button
              type="button"
              className="cursor-pointer rounded-control border border-line-2 bg-panel px-3 py-1.5 text-[0.78125rem] hover:bg-panel-2"
              onClick={() => setCreating(true)}
            >
              Novo cartão
            </button>
            <HeaderSelect
              label="Cartão"
              current="Todos os cartões"
              selected="todos"
              footer="Escolha um cartão para ver só as faturas dele."
              options={[
                { id: 'todos', label: 'Todos os cartões', amount: money(w.total_devido) },
                ...data.cards.map((c) => ({
                  id: c.card.id,
                  label: c.card.name,
                  amount: cardTotal(c),
                })),
              ]}
              onSelect={(id) => id !== 'todos' && navigate(financeRoutes.card(id))}
            />
          </>
        }
      />
      <StatStrip
        label="Resumo dos cartões"
        cells={[
          {
            id: 'devido',
            label: 'Total devido',
            value: money(w.total_devido),
            caption: 'fechadas + abertas',
            to: totalLink({ kind: 'faturas' }),
          },
          {
            id: 'fechadas',
            label: 'Fechadas a pagar',
            value: money(w.fechadas_a_pagar),
            caption:
              sum.closed_first_due === null
                ? 'nenhuma fatura fechada'
                : `${plural(sum.closed_count, 'fatura', 'faturas')} · primeira vence ${dayMonth(sum.closed_first_due)}`,
          },
          {
            id: 'abertas',
            label: 'Abertas',
            value: money(w.abertas),
            caption: `${plural(sum.open_count, 'fatura', 'faturas')} · ${duesText(sum.open_dues)}`,
          },
          {
            id: 'parcelas',
            label: 'Parcelas futuras',
            value: money(data.installments_total),
            caption: 'compromisso já assumido',
          },
          {
            id: 'limite',
            label: 'Limite disponível',
            value: money(sum.limit_available),
            caption: `de ${money(sum.limit_total)} · ${sum.limit_used_percent}% usado`,
          },
        ]}
      />
      {data.cards.length === 0 ? (
        <EmptyPanel
          message="Você ainda não cadastrou nenhum cartão."
          actionLabel="Novo cartão"
          onAction={() => setCreating(true)}
        />
      ) : (
        <Panel
          title="Faturas por cartão"
          action={<span className="text-xs text-ink-3">fechadas a pagar e abertas</span>}
        >
          <FinTable caption="Faturas por cartão">
            <THead>
              <Th>Fatura</Th>
              <Th>Fechamento</Th>
              <Th className="max-md:hidden">Vencimento</Th>
              <Th className="max-lg:hidden">Pagamento previsto</Th>
              <Th align="right">Valor (R$)</Th>
              <Th>Situação</Th>
            </THead>
            <tbody>
              {data.cards.map((row) => (
                <Fragment key={row.card.id}>
                  <tr className="border-t border-line bg-panel-2">
                    <td colSpan={4} className="px-3 py-2">
                      <span className="font-semibold">{row.card.name}</span>
                      <span className="text-ink-3">
                        {' '}
                        · final {row.card.last4} · paga com{' '}
                        {payerName(row.card.pay_account_id)}
                      </span>
                    </td>
                    <td colSpan={2} className="px-3 py-2">
                      <span className="flex items-center justify-end gap-3 text-xs text-ink-3">
                        <span className="tabular">
                          limite{' '}
                          {
                            formatMoney(row.card.limit_amount, { hidden, bare: true })
                              .text
                          }
                          {' · '}
                          disponível{' '}
                          {formatMoney(row.limit.available, { hidden, bare: true }).text}
                        </span>
                        <LimitMeter percent={row.limit.percent} />
                        <Link
                          to={financeRoutes.card(row.card.id)}
                          className="text-sm text-accent hover:underline"
                        >
                          Abrir cartão
                        </Link>
                      </span>
                    </td>
                  </tr>
                  {owedOf(row).map((inv) => {
                    const isOpen = inv.status === 'aberta';
                    return (
                      <tr
                        key={inv.month}
                        className={`border-t border-line ${isOpen ? '' : 'planned-stripes'}`}
                      >
                        <td className="px-3 py-[var(--row-pad)] font-semibold">
                          {isOpen ? 'Fatura aberta' : 'Fatura fechada'}
                        </td>
                        <td className="tabular px-3 py-[var(--row-pad)] text-ink-2">
                          {isOpen ? 'fecha' : 'fechou'} {dayMonth(inv.closing)}
                        </td>
                        <td className="tabular px-3 py-[var(--row-pad)] max-md:hidden">
                          {dayMonth(inv.due)}
                        </td>
                        <td className="px-3 py-[var(--row-pad)] max-lg:hidden">
                          {isOpen ? (
                            <span className="text-ink-3">ainda não fechou</span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <KindTag kind="PAGAMENTO_FATURA">Pag. de fatura</KindTag>
                              <span className="tabular">{dayMonth(inv.due)}</span>
                            </span>
                          )}
                        </td>
                        <td className="tabular px-3 py-[var(--row-pad)] text-right font-semibold">
                          {money(inv.remaining)}
                        </td>
                        <td className="px-3 py-[var(--row-pad)]">
                          <span className="flex items-center justify-between gap-3">
                            <StatusTag
                              status={isOpen ? 'aberta' : 'fechada'}
                              label={isOpen ? 'Aberta' : 'A pagar'}
                            />
                            {isOpen ? null : (
                              <button
                                type="button"
                                className="cursor-pointer rounded-control bg-accent-soft px-3 py-1 text-[0.8125rem] font-semibold text-accent hover:underline"
                                onClick={() => setPaying(row.card.id)}
                              >
                                Lançar
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </FinTable>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
            <span>
              As compras já entraram em Despesas na data de cada compra. Pagar a fatura
              sai da conta, mas não é despesa.
            </span>
            <Link
              to={financeRoutes.card(
                data.cards[0]?.card.id ?? '',
                data.cards[0]?.invoice.month,
              )}
              className="text-accent hover:underline"
            >
              Abrir a fatura de um cartão
            </Link>
          </footer>
        </Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Pagamentos previstos"
          action={
            <span className="text-xs text-ink-3">saem da conta, entram no cartão</span>
          }
        >
          {data.planned_payments.length === 0 ? (
            <EmptyPanel message="Nenhum pagamento de fatura previsto." />
          ) : (
            <FinTable caption="Pagamentos previstos">
              <THead>
                <Th>Dia</Th>
                <Th>Conta → Cartão</Th>
                <Th align="right">Valor (R$)</Th>
              </THead>
              <tbody>
                {data.planned_payments.map((p) => (
                  <tr key={`${p.card_id}:${p.month}`} className="border-t border-line">
                    <td className="tabular px-3 py-[var(--row-pad)] text-ink-2">
                      {dayMonth(p.due)}
                    </td>
                    <td className="px-3 py-[var(--row-pad)]">
                      {payerName(p.account_id)}
                      <Arrow />
                      {cardName(p.card_id)}
                    </td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right font-semibold">
                      −{formatMoney(p.amount, { hidden, bare: true }).text}
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
                    Total
                  </th>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right">
                    −{formatMoney(data.planned_total, { hidden, bare: true }).text}
                  </td>
                </tr>
              </tfoot>
            </FinTable>
          )}
        </Panel>
        <Panel
          title="Parcelamentos ativos"
          action={<span className="text-xs text-ink-3">compromisso já assumido</span>}
        >
          {data.installments.length === 0 ? (
            <EmptyPanel message="Nenhum parcelamento em andamento." />
          ) : (
            <FinTable caption="Parcelamentos ativos">
              <THead>
                <Th>Compra</Th>
                <Th align="right">Parcela atual</Th>
                <Th align="right">Parcela (R$)</Th>
                <Th align="right">Falta pagar</Th>
              </THead>
              <tbody>
                {data.installments.map((plan) => (
                  <tr
                    key={`${plan.card_id}:${plan.description}`}
                    className="border-t border-line"
                  >
                    <td className="px-3 py-[var(--row-pad)]">
                      <span className="font-semibold">{plan.description}</span>
                      <span className="block text-xs text-ink-3">
                        {cardName(plan.card_id)}
                      </span>
                    </td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right text-ink-2">
                      {plan.current}/{plan.total}
                    </td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right">
                      {formatMoney(plan.amount, { hidden, bare: true }).text}
                    </td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right font-semibold">
                      {money(plan.remaining)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-semibold">
                  <th
                    scope="row"
                    colSpan={3}
                    className="px-3 py-[var(--row-pad)] text-left"
                  >
                    Total a pagar
                  </th>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right">
                    {money(data.installments_total)}
                  </td>
                </tr>
              </tfoot>
            </FinTable>
          )}
        </Panel>
      </div>
      {creating && (
        <CardModal
          accounts={[...names].map(([id, name]) => ({ id, name }))}
          existingNames={data.cards.map((c) => c.card.name)}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setCreating(false)}
        />
      )}
      {paying !== null && (
        <NewEntryModal
          today={data.as_of}
          accounts={[...names].map(([id, name]) => ({ id, name }))}
          context={{ cardId: paying, invoice: true }}
          initialKind="PAGAMENTO_FATURA"
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setPaying(null)}
          onConflict={() => setReload((n) => n + 1)}
        />
      )}
      {launching && (
        <NewEntryModal
          today={data.as_of}
          accounts={[...names].map(([id, name]) => ({ id, name }))}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setLaunching(false)}
        />
      )}
    </div>
  );
};

/** A barra fina de uso do limite, sem número: o percentual já está na faixa. */
const LimitMeter = ({ percent }: { readonly percent: number }): React.ReactElement => (
  <span
    role="progressbar"
    aria-label="Limite usado"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.min(100, percent)}
    className="relative h-1.5 w-24 overflow-hidden rounded-full bg-line"
  >
    <span
      className="absolute inset-y-0 left-0 rounded-full bg-ink"
      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
    />
  </span>
);
