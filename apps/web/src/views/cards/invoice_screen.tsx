import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/icon.js';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { fetchAccountNames } from '../../api/book.js';
import { fetchInvoice } from '../../api/invoice.js';
import type {
  InvoiceBlock,
  InvoiceLineResource,
  InvoiceResource,
} from '../../api/invoice.js';
import { deleteLine, deletePayment, moveLine } from '../../api/invoice_write.js';
import { ApiError } from '../../api/client.js';
import { fetchCategories } from '../../api/ledger_write.js';
import type { CategoryOption } from '../../api/ledger_write.js';
import { AlertModal, Menu } from '../../components/overlay.js';
import { newAttemptKey } from '../../lib/entry.js';
import {
  canReverse,
  readOnly,
  reversalMonth,
  reversalRequest,
} from '../../lib/invoice_actions.js';
import { NewEntryModal } from '../ledger/new_entry_modal.js';
import { InvoiceItemModal } from './invoice_item_modal.js';
import { usePreferences } from '../../components/preferences.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { PanelError } from '../../finance/components/states.js';
import { Panel } from '../../components/primitives.js';
import {
  FilterBar,
  ToolbarIconButton,
  ToolbarSearch,
} from '../../components/filter_bar.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { StatStrip } from '../../finance/components/stat_strip.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { Arrow, LedgerKindTag } from '../ledger/ledger_parts.js';
import { HeaderSelect } from './header_select.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { downloadCsv } from '../../finance/lib/csv.js';
import { monthLabel } from '../../lib/cards_view.js';
import { formatMoney } from '../../lib/format.js';
import { Select } from '../entry/fields.js';
import {
  exportInvoiceRows,
  filterInvoiceLines,
  LINE_TYPE_LABEL,
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
  const [categoryList, setCategoryList] = useState<readonly CategoryOption[]>([]);
  const [dialog, setDialog] = useState<
    | { kind: 'credito' | 'encargo'; line?: InvoiceLineResource }
    | { kind: 'mover'; line: InvoiceLineResource }
    | { kind: 'excluir'; line: InvoiceLineResource }
    | { kind: 'pagamento'; paymentId: string }
    | null
  >(null);
  const [moveTo, setMoveTo] = useState('');
  const [entering, setEntering] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cats, setCats] = useState<readonly string[]>([]);
  const [installment, setInstallment] = useState('');
  const [sortValue, setSortValue] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
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
      .then((list) => {
        setCategoryList(list);
        setCategories(new Map(list.map((c) => [c.id, c.name])));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [id, month, reload]);

  const categoryName = (cid: string | null): string =>
    cid === null ? '' : (categories.get(cid) ?? '');
  const visible = useMemo(
    () =>
      data === null ? [] : filterInvoiceLines(data.lines, query, types, categoryName),
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
  const goTo = (m: string): void => {
    void navigate(
      `/cartoes/${card.id}/faturas/${m}${params.toString() === '' ? '' : `?${params}`}`,
    );
  };
  const set = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const locked = readOnly(summary.status);
  const run = (job: Promise<unknown>): void => {
    void job
      .then(() => {
        setDialog(null);
        setReload((n) => n + 1);
      })
      .catch((error: unknown) => {
        setActionError(
          error instanceof ApiError ? error.message : 'Não foi possível concluir.',
        );
        setReload((n) => n + 1);
      });
  };
  const moveOptions = data.unpaid_months.filter((m) => m !== month);
  const dm = (iso: string): string => `${iso.slice(8)}/${iso.slice(5, 7)}`;
  const fullMonth = (key: string): string =>
    new Date(
      Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1),
    ).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
  const statusWord = (status: string): string =>
    status === 'aberta'
      ? 'aberta'
      : status === 'paga'
        ? 'paga'
        : status === 'prevista'
          ? 'prevista'
          : status === 'parcial'
            ? 'parcial'
            : 'fechada';
  const isPaid = summary.status === 'paga';
  const lastPayment = data.payments
    .map((p) => p.date)
    .sort()
    .at(-1);
  const payer = accountName(card.pay_account_id);
  const bare = (value: string): string => formatMoney(value, { hidden, bare: true }).text;
  const shownLines = [...visible]
    .filter(
      (l) =>
        (cats.length === 0 || (l.category_id !== null && cats.includes(l.category_id))) &&
        (installment === '' ||
          (installment === 'parcelado') === (l.installment !== null)),
    )
    .reverse();
  const sorted =
    sortValue === ''
      ? shownLines
      : [...shownLines].sort((a, b) =>
          sortValue === 'maior'
            ? Number(b.amount) - Number(a.amount)
            : Number(a.amount) - Number(b.amount),
        );
  const payable = data.payable;
  const entriesLink = financeRoutes.entries(`cartao=${encodeURIComponent(card.id)}`);

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title={card.name}
        subtitle={`Final ${card.last4} · paga com ${payer} · fatura de ${fullMonth(month)}`}
        primary={
          locked ? undefined : { label: 'Movimentação', onClick: () => setEntering(true) }
        }
        extra={
          <HeaderSelect
            label="Fatura"
            current={`${cap(fullMonth(month))} · ${statusWord(summary.status)}`}
            selected={month}
            footer="Uma fatura por vez. A escolha troca só esta tela."
            options={data.invoices.map((i) => ({
              id: i.month,
              label: `${cap(fullMonth(i.month))} · ${statusWord(i.status)}`,
              amount: money(i.total),
            }))}
            onSelect={goTo}
          />
        }
      />
      <StatStrip
        label="Resumo da fatura"
        cells={[
          {
            id: 'fatura',
            label: `Fatura de ${fullMonth(month)}`,
            value: (
              <span className={isPaid ? 'text-positive' : ''}>
                {money(summary.total)}
              </span>
            ),
            caption: isPaid
              ? `paga em ${lastPayment === undefined ? '—' : dm(lastPayment)} com ${payer}`
              : summary.status === 'aberta'
                ? `aberta · fecha em ${dm(summary.closing)} · vence ${dm(summary.due)}`
                : `${statusWord(summary.status)} · vence ${dm(summary.due)}`,
          },
          ...(isPaid
            ? [
                {
                  id: 'periodo',
                  label: 'Período',
                  value: `${dm(data.period.from)} – ${dm(data.period.to)}`,
                  caption: `fechou em ${dm(summary.closing)} · venceu ${dm(summary.due)}`,
                },
              ]
            : []),
          {
            id: 'compras',
            label: 'Compras',
            value: `${data.purchases.count} ${data.purchases.count === 1 ? 'movimentação' : 'movimentações'}`,
            caption:
              data.purchases.from === null || data.purchases.to === null
                ? 'sem compras'
                : `de ${dm(data.purchases.from)} a ${dm(data.purchases.to)}`,
          },
          {
            id: 'categoria',
            label: 'Maior categoria',
            value: data.largest_category?.name ?? '—',
            caption:
              data.largest_category === null
                ? 'sem compras'
                : `${money(data.largest_category.amount)} · ${data.largest_category.percent}% da fatura`,
          },
          ...(isPaid
            ? []
            : [
                {
                  id: 'limite',
                  label: 'Limite disponível',
                  value: money(data.limit.available),
                  caption: `de ${money(data.limit.total)} · ${data.limit.percent}% usado`,
                },
              ]),
        ]}
      />
      {isPaid && data.payments.length > 0 ? (
        <Panel
          title="Pagamento da fatura"
          action={
            <span className="text-xs text-ink-3">movimentação ligada à fatura</span>
          }
        >
          <FinTable caption="Pagamento da fatura">
            <THead>
              <Th>Dia</Th>
              <Th>Descrição</Th>
              <Th className="max-md:hidden">Tipo</Th>
              <Th>Conta → Cartão</Th>
              <Th>Situação</Th>
              <Th align="right">Valor (R$)</Th>
              <Th>
                <span className="sr-only">Ações</span>
              </Th>
            </THead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="tabular px-3 py-[var(--row-pad)] text-ink-2">
                    {dm(p.date)}
                  </td>
                  <td className="px-3 py-[var(--row-pad)] font-medium">
                    Pagamento da fatura {card.name} ({fullMonth(month).slice(0, 3)})
                  </td>
                  <td className="px-3 py-[var(--row-pad)] max-md:hidden">
                    <LedgerKindTag kind="PAGAMENTO_FATURA" planned={false} />
                  </td>
                  <td className="px-3 py-[var(--row-pad)]">
                    {accountName(p.account_id)}
                    <Arrow />
                    {card.name}
                  </td>
                  <td className="px-3 py-[var(--row-pad)] text-ink-2">Lançado</td>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right font-semibold">
                    −{bare(p.amount)}
                  </td>
                  <td className="px-3 py-[var(--row-pad)] text-right">
                    <button
                      type="button"
                      className="cursor-pointer text-xs text-negative underline"
                      onClick={() => {
                        setActionError(null);
                        setDialog({ kind: 'pagamento', paymentId: p.id });
                      }}
                    >
                      Excluir pagamento
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </FinTable>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
            <span>
              O pagamento sai de {payer} e zera a fatura. Não é despesa: as compras já
              foram contadas.
            </span>
            <Link
              to={financeRoutes.account(card.pay_account_id)}
              className="text-accent hover:underline"
            >
              Ver no extrato da conta
            </Link>
          </footer>
        </Panel>
      ) : null}
      <Panel className="overflow-visible">
        <FilterBar
          search={
            <ToolbarSearch
              value={query}
              label="Buscar na fatura"
              placeholder="Buscar na fatura"
              onChange={(q) => set('q', q)}
            />
          }
          fields={[
            {
              id: 'categoria',
              label: 'Categoria',
              icon: 'tag',
              options: categoryList.map((c) => ({ id: c.id, label: c.name })),
              selected: cats,
              onChange: setCats,
            },
            {
              id: 'parcelado',
              label: 'Parcelado',
              icon: 'card',
              options: [
                { id: 'parcelado', label: 'Parcelado' },
                { id: 'avista', label: 'À vista' },
              ],
              selected: installment === '' ? [] : [installment],
              onChange: (next) => setInstallment(next.at(-1) ?? ''),
            },
          ]}
          extraCount={query === '' ? 0 : 1}
          display={{
            sortBy: {
              label: 'Ordenar por',
              value: sortValue,
              options: [
                { value: '', label: 'Padrão' },
                { value: 'maior', label: 'Maior valor' },
                { value: 'menor', label: 'Menor valor' },
              ],
              onChange: setSortValue,
            },
          }}
          actions={
            <>
              {locked ? null : (
                <>
                  <button
                    type="button"
                    className="inline-flex h-[30px] cursor-pointer items-center rounded-control border border-line-2 bg-panel px-[11px] text-[0.78125rem] font-medium hover:bg-panel-2"
                    onClick={() => setDialog({ kind: 'credito' })}
                  >
                    Novo crédito
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-[30px] cursor-pointer items-center rounded-control border border-line-2 bg-panel px-[11px] text-[0.78125rem] font-medium hover:bg-panel-2"
                    onClick={() => setDialog({ kind: 'encargo' })}
                  >
                    Novo encargo
                  </button>
                </>
              )}
              <ToolbarIconButton
                label="Exportar"
                icon="download"
                onClick={() =>
                  downloadCsv(
                    `fatura-${card.name}-${month}.csv`,
                    exportInvoiceRows(data.lines, categoryName),
                  )
                }
              />
            </>
          }
        />
        {data.lines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">
            Esta fatura ainda não tem nenhuma movimentação.
          </p>
        ) : (
          <FinTable caption="Linhas da fatura">
            <THead>
              <Th>Dia</Th>
              <Th>Descrição</Th>
              <Th className="max-md:hidden">Categoria</Th>
              <Th align="right">Valor (R$)</Th>
              <Th align="right">Fatura acumulada (R$)</Th>
              <Th>
                <span className="sr-only">Ações</span>
              </Th>
            </THead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="tabular px-3 py-[var(--row-pad)] text-ink-2">
                    {dm(l.date)}
                  </td>
                  <td className="px-3 py-[var(--row-pad)] font-medium">
                    {l.origin === 'entry' ? (
                      <Link
                        className="hover:underline"
                        to={`/lancamentos?q=${encodeURIComponent(l.description)}`}
                      >
                        {l.description}
                      </Link>
                    ) : (
                      l.description
                    )}
                    {l.installment !== null && (
                      <span className="ml-1.5 rounded-[4px] bg-panel-2 px-1.5 py-0.5 text-xs font-normal text-ink-2">
                        {l.installment.no}/{l.installment.total}
                      </span>
                    )}
                    {l.block === 'creditos' || l.block === 'encargos' ? (
                      <span className="ml-1.5 rounded-[4px] bg-panel-2 px-1.5 py-0.5 text-xs font-normal text-ink-2">
                        {l.block === 'creditos' ? 'crédito' : 'encargo'}
                      </span>
                    ) : null}
                    {l.forecast && (
                      <span className="ml-1.5 text-xs font-normal text-ink-3 max-sm:hidden">
                        prevista
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-[var(--row-pad)] text-ink-2 max-md:hidden">
                    {categoryName(l.category_id) || '—'}
                  </td>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right font-medium">
                    {l.block === 'creditos' ? `+${bare(l.amount)}` : `−${bare(l.amount)}`}
                  </td>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right font-semibold">
                    {bare(l.accumulated)}
                  </td>
                  <td className="px-3 py-[var(--row-pad)] text-right">
                    {!locked && (
                      <Menu
                        label={`Ações de ${l.description}`}
                        items={[
                          {
                            id: 'estornar',
                            label: 'Estornar',
                            icon: <Icon name="undo" />,
                            disabled: !canReverse(l, summary.status),
                            onSelect: () => setDialog({ kind: 'credito', line: l }),
                          },
                          {
                            id: 'mover',
                            label: 'Mover de fatura',
                            icon: <Icon name="card" />,
                            onSelect: () => {
                              setMoveTo('');
                              setActionError(null);
                              setDialog({ kind: 'mover', line: l });
                            },
                          },
                          {
                            id: 'excluir',
                            label: 'Excluir',
                            icon: <Icon name="trash" />,
                            destructive: true,
                            onSelect: () => {
                              setActionError(null);
                              setDialog({ kind: 'excluir', line: l });
                            },
                          },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-panel-2 font-semibold">
                <th
                  scope="row"
                  colSpan={4}
                  className="px-3 py-[var(--row-pad)] text-left"
                >
                  Início da fatura · {dm(data.period.from)}
                </th>
                <td className="tabular px-3 py-[var(--row-pad)] text-right">
                  {bare('0.00')}
                </td>
                <td />
              </tr>
            </tfoot>
          </FinTable>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
          <span>
            {isPaid
              ? 'Fatura paga: as linhas não mudam mais, a menos que eu edite uma compra.'
              : 'Cada compra é uma despesa na data em que foi feita. A fatura acumulada soma as compras até a linha.'}
          </span>
          <Link to={entriesLink} className="text-accent hover:underline">
            Ver no livro com este cartão
          </Link>
        </footer>
      </Panel>
      {payable !== null && !isPaid ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Pagamento previsto"
            hint={
              <button
                type="button"
                className="cursor-pointer rounded-control bg-accent px-3 py-1.5 text-[0.8125rem] font-semibold text-accent-ink hover:opacity-90"
                onClick={() => setPaying(true)}
              >
                Lançar pagamento
              </button>
            }
            action={
              <span className="text-xs text-ink-3">
                fatura de {fullMonth(payable.summary.month)} ·{' '}
                {statusWord(payable.summary.status)}
              </span>
            }
          >
            <FinTable caption="Efeito do pagamento">
              <THead>
                <Th>Contas e cartão</Th>
                <Th align="right">Antes</Th>
                <Th align="right">Depois</Th>
              </THead>
              <tbody>
                {[
                  [`Em contas em ${dm(payable.preview.due)}`, payable.preview.em_contas],
                  [
                    `Fatura de ${fullMonth(payable.summary.month)} do ${card.name}`,
                    payable.preview.fatura,
                  ],
                  ['Total devido por cartões', payable.preview.total_devido],
                  ['Despesas do mês', payable.preview.despesas_do_mes],
                ].map(([label, pair]) => {
                  const values = pair as { before: string; after: string };
                  return (
                    <tr key={label as string} className="border-t border-line">
                      <td className="px-3 py-[var(--row-pad)]">{label as string}</td>
                      <td className="tabular px-3 py-[var(--row-pad)] text-right text-ink-2">
                        {bare(values.before)}
                      </td>
                      <td className="tabular px-3 py-[var(--row-pad)] text-right font-semibold">
                        {bare(values.after)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </FinTable>
            <p className="border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
              Despesas do mês não muda: as compras já foram contadas quando aconteceram.
            </p>
          </Panel>
          <Panel
            title={`Fatura de ${fullMonth(payable.summary.month)}`}
            hint={
              payable.summary.month === month ? undefined : (
                <Link
                  to={financeRoutes.card(card.id, payable.summary.month)}
                  className="text-[0.8125rem] text-accent hover:underline"
                >
                  Abrir
                </Link>
              )
            }
            action={
              <span className="text-xs text-ink-3">
                fechada em {dm(payable.summary.closing)} · vence {dm(payable.summary.due)}
              </span>
            }
          >
            <FinTable caption="Composição da fatura a pagar">
              <THead>
                <Th>Item</Th>
                <Th align="right">Valor (R$)</Th>
              </THead>
              <tbody>
                <tr className="border-t border-line">
                  <td className="px-3 py-[var(--row-pad)]">
                    Compras de {dm(payable.period.from)} a {dm(payable.period.to)} ·{' '}
                    {payable.breakdown.compras.count} movimentações
                  </td>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right">
                    {bare(payable.breakdown.compras.amount)}
                  </td>
                </tr>
                {payable.breakdown.parcelas.map((part) => (
                  <tr
                    key={`${part.description}:${part.no}`}
                    className="border-t border-line"
                  >
                    <td className="px-3 py-[var(--row-pad)]">
                      Parcela do {part.description.toLowerCase()} · {part.no}/{part.total}
                    </td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right">
                      {bare(part.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <td className="px-3 py-[var(--row-pad)]">Estornos e créditos</td>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right text-ink-3">
                    {bare(payable.breakdown.creditos)}
                  </td>
                </tr>
                {payable.breakdown.encargos === '0.00' ? null : (
                  <tr className="border-t border-line">
                    <td className="px-3 py-[var(--row-pad)]">Encargos</td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right">
                      {bare(payable.breakdown.encargos)}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-semibold">
                  <th scope="row" className="px-3 py-[var(--row-pad)] text-left">
                    Total a pagar
                  </th>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right">
                    {money(payable.breakdown.total)}
                  </td>
                </tr>
              </tfoot>
            </FinTable>
          </Panel>
        </div>
      ) : null}
      {paying && (
        <NewEntryModal
          today={data.as_of}
          accounts={[...names].map(([aid, name]) => ({ id: aid, name }))}
          context={{ cardId: card.id, invoice: true }}
          initialKind="PAGAMENTO_FATURA"
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setPaying(false)}
          onConflict={() => setReload((n) => n + 1)}
        />
      )}
      {entering && (
        <NewEntryModal
          today={data.summary.closing}
          accounts={[...names].map(([aid, name]) => ({ id: aid, name }))}
          context={{ cardId: card.id }}
          initialKind="DESPESA"
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setEntering(false)}
        />
      )}
      {(dialog?.kind === 'credito' || dialog?.kind === 'encargo') && (
        <InvoiceItemModal
          cardId={card.id}
          kind={dialog.kind}
          month={
            dialog.line === undefined
              ? month
              : (reversalMonth(month, data.unpaid_months) ?? month)
          }
          months={data.unpaid_months}
          categories={categoryList}
          reversesId={dialog.line?.id}
          initial={
            dialog.line === undefined
              ? undefined
              : (() => {
                  const r = reversalRequest(dialog.line, month);
                  return {
                    subtype: r.subtype,
                    description: r.description,
                    amount: r.amount.replace('.', ','),
                  };
                })()
          }
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'mover' && (
        <AlertModal
          icon="swap"
          open
          danger={false}
          title={`Mover "${dialog.line.description}" de fatura`}
          message={
            <>
              <Select
                aria-label="Mover para a fatura"
                invalid={false}
                placeholder="Escolha a fatura"
                options={moveOptions.map((m) => ({ id: m, name: monthLabel(m) }))}
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
              />
              {actionError !== null && (
                <span role="alert" className="mt-2 block text-negative">
                  {actionError}
                </span>
              )}
            </>
          }
          cancelLabel="Cancelar"
          confirmLabel="Mover"
          pending={moveTo === ''}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            run(moveLine(dialog.line.origin, dialog.line.id, moveTo, newAttemptKey()))
          }
        />
      )}
      {dialog?.kind === 'pagamento' && (
        <AlertModal
          open
          title="Excluir o pagamento?"
          message={
            <>
              O valor volta para a conta e a fatura reabre.
              {actionError !== null && (
                <span role="alert" className="mt-2 block text-negative">
                  {actionError}
                </span>
              )}
            </>
          }
          cancelLabel="Cancelar"
          confirmLabel="Excluir pagamento"
          onCancel={() => setDialog(null)}
          onConfirm={() => run(deletePayment(dialog.paymentId, newAttemptKey()))}
        />
      )}
      {dialog?.kind === 'excluir' && (
        <AlertModal
          open
          title={`Excluir "${dialog.line.description}"?`}
          message={
            <>
              A linha sai da fatura
              {dialog.line.installment === null ? '' : ' (só esta parcela)'}.
              {actionError !== null && (
                <span role="alert" className="mt-2 block text-negative">
                  {actionError}
                </span>
              )}
            </>
          }
          cancelLabel="Cancelar"
          confirmLabel="Excluir"
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            run(
              deleteLine(
                dialog.line.origin,
                dialog.line.id,
                dialog.line.installment !== null,
                newAttemptKey(),
              ),
            )
          }
        />
      )}
    </div>
  );
};
