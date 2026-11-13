import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { fetchAccountNames } from '../../api/book.js';
import { fetchCardsOverview } from '../../api/cards_overview.js';
import type { CardsResource } from '../../api/cards_overview.js';
import { usePreferences } from '../../components/preferences.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { StatStrip } from '../../finance/components/stat_strip.js';
import { EmptyPanel, PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import {
  barWidth,
  daysBetween,
  dueIn,
  groupByPayer,
  monthLabel,
  nextDue,
  payerTitle,
} from '../../lib/cards_view.js';
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

  const groups = useMemo(() => (data === null ? [] : groupByPayer(data.cards)), [data]);

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
  const due = nextDue(data.cards);

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Cartões"
        primary={{ label: 'Novo cartão', onClick: () => setCreating(true) }}
        subtitle={`Faturas abertas ${money(w.abertas)}${due === null ? '' : ` · próximo vencimento ${dayMonth(due)}`}`}
        extra={
          <label className="text-sm">
            <span className="sr-only">Cartão</span>
            <select
              aria-label="Cartão"
              className="cursor-pointer rounded-field border border-line px-2 py-1.5"
              value=""
              onChange={(e) =>
                e.target.value !== '' && navigate(`/cartoes/${e.target.value}`)
              }
            >
              <option value="">Cartão: Todos</option>
              {data.cards.map((c) => (
                <option key={c.card.id} value={c.card.id}>
                  {c.card.name}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <Link to="/contas" aria-label="Ir para Contas" className="block no-underline">
        <StatStrip
          label="Livre após faturas"
          cells={[
            { id: 'contas', label: 'Em contas', value: money(w.em_contas) },
            { id: 'devido', label: 'Total devido', value: money(w.total_devido) },
            {
              id: 'livre',
              label: 'Livre após faturas',
              value: money(w.livre),
              caption: Number(w.falta) > 0 ? `faltam ${money(w.falta)}` : undefined,
            },
          ]}
        />
      </Link>
      {data.cards.length === 0 ? (
        <EmptyPanel
          message="Você ainda não cadastrou nenhum cartão."
          actionLabel="Novo cartão"
          onAction={() => setCreating(true)}
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-label text-ink-3 uppercase">
              <th scope="col">Cartão</th>
              <th scope="col" className="text-right">
                Fatura aberta
              </th>
              <th scope="col" className="text-right">
                Fechada a pagar
              </th>
              <th scope="col" className="max-md:hidden">
                Vence
              </th>
              <th scope="col" className="max-lg:hidden">
                Limite usado
              </th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.accountId}>
                <tr className="bg-panel-2 font-medium">
                  <th scope="rowgroup" colSpan={4} className="text-left">
                    {payerTitle(
                      names.get(group.accountId) ?? 'Conta',
                      group.cards.length,
                    )}
                  </th>
                  <td colSpan={2} className="tabular text-right">
                    {money(group.due)}
                  </td>
                </tr>
                {group.cards.map((row) => {
                  const open = `/cartoes/${row.card.id}`;
                  const days =
                    row.debt.next_due === null
                      ? null
                      : daysBetween(data.as_of, row.debt.next_due);
                  return (
                    <tr
                      key={row.card.id}
                      tabIndex={0}
                      className="cursor-pointer hover:bg-panel-2"
                      onClick={() => navigate(open)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') navigate(open);
                        const sibling =
                          e.key === 'ArrowDown'
                            ? e.currentTarget.nextElementSibling
                            : e.key === 'ArrowUp'
                              ? e.currentTarget.previousElementSibling
                              : null;
                        if (sibling instanceof HTMLElement && sibling.tabIndex === 0) {
                          e.preventDefault();
                          sibling.focus();
                        }
                      }}
                    >
                      <th scope="row" className="text-left font-normal">
                        {row.card.name}
                        <span className="block text-xs text-ink-3">
                          final {row.card.last4}
                        </span>
                      </th>
                      <td className="tabular text-right">{money(row.debt.abertas)}</td>
                      <td className="tabular text-right">
                        {money(row.debt.fechadas_a_pagar)}
                      </td>
                      <td className="max-md:hidden">
                        {row.debt.next_due === null || days === null ? (
                          '—'
                        ) : (
                          <>
                            {dayMonth(row.debt.next_due)}
                            <span className="block text-xs text-ink-3">
                              {dueIn(days)}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="max-lg:hidden">
                        <div
                          role="progressbar"
                          aria-label={`Limite usado de ${row.card.name}`}
                          aria-valuenow={row.used_percent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          className="h-1.5 w-24 rounded-full bg-panel-2"
                        >
                          <div
                            className={`h-full rounded-full ${row.used_percent >= 90 ? 'bg-negative' : 'bg-accent'}`}
                            style={{ width: `${barWidth(row.used_percent)}%` }}
                          />
                        </div>
                        <span className="tabular text-xs text-ink-3">
                          {row.used_percent}%
                        </span>
                      </td>
                      <td
                        className="text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="cursor-pointer rounded-field border border-line px-2 py-1 text-xs"
                          onClick={() => setPaying(row.card.id)}
                        >
                          Pagar fatura
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="text-left">
                Total devido
              </th>
              <td className="tabular text-right">{money(w.abertas)}</td>
              <td className="tabular text-right">{money(w.fechadas_a_pagar)}</td>
              <td className="max-md:hidden" />
              <td className="tabular text-right" colSpan={2}>
                {money(w.total_devido)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
      {data.upcoming.length > 0 && (
        <section aria-label="Próximas faturas" className="flex flex-col gap-2">
          <h2 className="text-label text-ink-3 uppercase">Próximas faturas</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-label text-ink-3 uppercase">
                <th scope="col">Fatura de</th>
                {data.cards.map((c) => (
                  <th key={c.card.id} scope="col" className="text-right">
                    {c.card.name}
                  </th>
                ))}
                <th scope="col" className="text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.upcoming.map((row) => (
                <tr key={row.month}>
                  <th scope="row" className="text-left font-normal">
                    {monthLabel(row.month)}
                    <span className="block text-xs text-ink-3">{row.status}</span>
                  </th>
                  {data.cards.map((c) => {
                    const cell = row.cells.find((x) => x.card_id === c.card.id);
                    return (
                      <td key={c.card.id} className="tabular text-right">
                        {cell?.amount == null ? '—' : money(cell.amount)}
                      </td>
                    );
                  })}
                  <td className="tabular text-right">{money(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
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
    </div>
  );
};
