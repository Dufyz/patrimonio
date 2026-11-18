import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { setAccountArchived } from '../../api/account_write.js';
import { fetchAccounts } from '../../api/accounts.js';
import { ApiError } from '../../api/client.js';
import type { AccountRowResource, AccountsResource } from '../../api/accounts.js';
import { usePreferences } from '../../components/preferences.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { Panel } from '../../components/primitives.js';
import { FinTable, SortTh, Th } from '../../components/table_parts.js';
import { StatStrip } from '../../finance/components/stat_strip.js';
import type { IsoDate } from '../../finance/lib/dates.js';
import { EmptyPanel, PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { AlertModal } from '../../components/overlay.js';
import { formatMoney } from '../../lib/format.js';
import { nextSort, sortRows } from '../../lib/table_sort.js';
import type { SortState } from '../../lib/table_sort.js';
import { toCents } from '../../lib/projection_view.js';
import { needsExplicitConfirm } from '../../lib/account_form.js';
import { newAttemptKey } from '../../lib/entry.js';
import { NewEntryModal } from '../ledger/new_entry_modal.js';
import { AccountModal } from './account_modal.js';
import { RecentMovements } from './recent_movements.js';

/**
 * CTA-01 · Contas: onde está o dinheiro. Saldo de hoje, previsto de fim de mês e
 * a linha de total, que soma só as contas com "no patrimônio". Sem sparklines e
 * sem seção de benefícios; arquivadas ficam ocultas até "mostrar arquivadas".
 */
const isZeroText = (value: string): boolean => /^-?0+([.,]0+)?$/.test(value);

const asOf = (iso: string): string =>
  `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export const AccountsScreen = (): React.ReactElement => {
  const { hidden } = usePreferences();
  const navigate = useNavigate();
  const [data, setData] = useState<AccountsResource | null>(null);
  const [failed, setFailed] = useState(false);
  const [archived, setArchived] = useState(false);
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<'nova' | 'transferir' | null>(null);
  const [editing, setEditing] = useState<AccountRowResource | null>(null);
  const [archiving, setArchiving] = useState<AccountRowResource | null>(null);
  const [force, setForce] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const onSort = (key: string): void => setSort((current) => nextSort(current, key));
  const rows = useMemo(
    () =>
      sortRows(data?.accounts ?? [], sort, {
        conta: (row) => row.account.name,
        instituicao: (row) => row.account.institution,
        saldo: (row) => toCents(row.balance),
        previsto: (row) => toCents(row.projected_month_end),
      }),
    [data, sort],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchAccounts(archived, controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [archived, reload]);

  if (failed) {
    return (
      <PanelError
        title="Não foi possível carregar as contas"
        onRetry={() => {
          setFailed(false);
          setReload((n) => n + 1);
        }}
      />
    );
  }
  if (data === null) return <TableScreenSkeleton label="Carregando contas" columns={7} />;

  const money = (value: string): string => formatMoney(value, { hidden }).text;
  const counted = data.accounts.filter((r) => !r.account.archived && r.account.in_wealth);
  const countedIds = counted.map((r) => r.account.id).join(',');

  const dayMonth = (iso: string): string => `${iso.slice(8)}/${iso.slice(5, 7)}`;
  const shortfall = !isZeroText(data.debt.falta);
  const accountNames = new Map(data.accounts.map((r) => [r.account.id, r.account.name]));

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Contas"
        subtitle={`Em contas ${money(data.total_balance)} · saldos de ${asOf(data.as_of)}`}
        extra={
          <button
            type="button"
            className="cursor-pointer rounded-field border border-line px-3 py-1.5 text-sm"
            onClick={() => setModal('transferir')}
          >
            Transferir
          </button>
        }
        primary={{ label: 'Conta', onClick: () => setModal('nova') }}
      />
      <StatStrip
        label="Resumo das contas"
        cells={[
          {
            id: 'em-contas',
            label: 'Em contas',
            value: money(data.total_balance),
            caption: `saldos de ${asOf(data.as_of)}`,
          },
          {
            id: 'faturas',
            label: 'Faturas a pagar',
            value: money(data.debt.total_devido),
            caption: `fechadas ${money(data.debt.fechadas_a_pagar)} · abertas ${money(data.debt.abertas)}`,
          },
          {
            id: 'livre',
            label: 'Livre após faturas',
            value: (
              <span className={shortfall ? 'text-negative' : ''}>
                {money(data.debt.livre)}
              </span>
            ),
            caption: shortfall
              ? `limitado ao saldo; faltam ${money(data.debt.falta)}`
              : 'as contas cobrem as faturas',
          },
          {
            id: 'previsto',
            label: `Saldo previsto em ${dayMonth(data.projected_on)}`,
            value: money(data.projected_total),
            caption: 'com tudo o que está previsto',
          },
        ]}
      />
      <Panel
        title="Contas"
        action={
          <span className="flex items-center gap-4 text-xs text-ink-3">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />
              Mostrar arquivadas
            </label>
            <span>entram no saldo em contas</span>
          </span>
        }
      >
        {data.accounts.length === 0 ? (
          <EmptyPanel
            message={
              archived
                ? 'Nenhuma conta arquivada.'
                : 'Você ainda não cadastrou nenhuma conta.'
            }
            actionLabel="Nova conta"
            onAction={() => setModal('nova')}
          />
        ) : (
          <FinTable caption="Contas">
            <thead>
              <tr className="border-b border-line">
                <SortTh label="Conta" sortKey="conta" sort={sort} onSort={onSort} />
                <Th className="max-md:hidden">Tipo</Th>
                <SortTh
                  label="Saldo de hoje"
                  sortKey="saldo"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                />
                <SortTh
                  label={`Previsto em ${dayMonth(data.projected_on)}`}
                  sortKey="previsto"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                  className="max-sm:hidden"
                />
                <Th className="max-lg:hidden">Paga os cartões</Th>
                <Th className="max-xl:hidden">Próximo previsto</Th>
                <Th>
                  <span className="sr-only">Ações</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.account.id}
                  tabIndex={0}
                  className="cursor-pointer border-t border-line hover:bg-panel-2"
                  onClick={() => navigate(`/contas/${row.account.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/contas/${row.account.id}`);
                    const sibling =
                      e.key === 'ArrowDown'
                        ? e.currentTarget.nextElementSibling
                        : e.key === 'ArrowUp'
                          ? e.currentTarget.previousElementSibling
                          : null;
                    if (sibling instanceof HTMLElement) {
                      e.preventDefault();
                      sibling.focus();
                    }
                  }}
                >
                  <th
                    scope="row"
                    className="px-3 py-[var(--row-pad)] text-left font-semibold"
                  >
                    {row.account.name}
                    {row.account.archived ? (
                      <span className="ml-2 text-xs font-normal text-ink-3">
                        arquivada
                      </span>
                    ) : null}
                  </th>
                  <td className="px-3 py-[var(--row-pad)] text-ink-2 max-md:hidden">
                    {row.account.role}
                  </td>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right font-semibold">
                    {money(row.balance)}
                  </td>
                  <td className="tabular px-3 py-[var(--row-pad)] text-right max-sm:hidden">
                    {money(row.projected_month_end)}
                  </td>
                  <td className="px-3 py-[var(--row-pad)] text-ink-2 max-lg:hidden">
                    {row.cards.length === 0 ? '—' : row.cards.join(' · ')}
                  </td>
                  <td className="px-3 py-[var(--row-pad)] text-ink-2 max-xl:hidden">
                    {row.next_planned === null
                      ? '—'
                      : `${dayMonth(row.next_planned.date)} · ${row.next_planned.label}`}
                  </td>
                  <td
                    className="px-3 py-[var(--row-pad)] text-right whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link
                      to={`/contas/${row.account.id}`}
                      className="cursor-pointer text-accent hover:underline"
                    >
                      Abrir extrato
                    </Link>
                    <span className="ml-3 text-xs text-ink-3">
                      <button
                        type="button"
                        className="cursor-pointer underline"
                        onClick={() => setEditing(row)}
                      >
                        Editar
                      </button>{' '}
                      <button
                        type="button"
                        className="cursor-pointer underline"
                        onClick={() => {
                          setForce(false);
                          setArchiveError(null);
                          if (row.account.archived) {
                            void setAccountArchived(
                              row.account.id,
                              false,
                              newAttemptKey(),
                            )
                              .then(() => setReload((n) => n + 1))
                              .catch(() => setFailed(true));
                          } else setArchiving(row);
                        }}
                      >
                        {row.account.archived ? 'Reativar' : 'Arquivar'}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr
                tabIndex={0}
                className="cursor-pointer border-t border-line bg-panel-2 font-semibold hover:bg-panel-2"
                onClick={() => navigate(financeRoutes.entries(`conta=${countedIds}`))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')
                    navigate(financeRoutes.entries(`conta=${countedIds}`));
                }}
              >
                <th scope="row" className="px-3 py-[var(--row-pad)] text-left">
                  Total em contas
                </th>
                <td className="max-md:hidden" />
                <td className="tabular px-3 py-[var(--row-pad)] text-right">
                  {money(data.total_balance)}
                </td>
                <td className="tabular px-3 py-[var(--row-pad)] text-right max-sm:hidden">
                  {money(data.projected_total)}
                </td>
                <td colSpan={3} className="max-lg:hidden" />
              </tr>
            </tfoot>
          </FinTable>
        )}
        <p className="border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
          Faturas só descontam do saldo das contas, no máximo até zerá-lo. Não mexem nas
          carteiras.
        </p>
      </Panel>
      <RecentMovements today={data.as_of as IsoDate} accounts={accountNames} />
      {(modal === 'nova' || editing !== null) && (
        <AccountModal
          today={data.as_of}
          editing={
            editing === null
              ? undefined
              : {
                  id: editing.account.id,
                  draft: {
                    name: editing.account.name,
                    role: editing.account.role,
                    type: editing.account.type as 'corrente' | 'poupanca' | 'carteira',
                    institution: editing.account.institution ?? '',
                    openingAmount: editing.account.opening_amount.replace('.', ','),
                    openingDate: editing.account.opening_date,
                    inWealth: editing.account.in_wealth,
                  },
                }
          }
          existingNames={data.accounts
            .filter((r) => r.account.id !== editing?.account.id)
            .map((r) => r.account.name)}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => {
            setModal(null);
            setEditing(null);
          }}
        />
      )}
      {modal === 'transferir' && (
        <NewEntryModal
          today={data.as_of}
          accounts={data.accounts
            .filter((r) => !r.account.archived)
            .map((r) => ({ id: r.account.id, name: r.account.name }))}
          initialKind="TRANSFERENCIA"
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setModal(null)}
        />
      )}
      {archiving !== null && (
        <AlertModal
          icon="archive"
          open
          title={`Arquivar ${archiving.account.name}?`}
          message={
            <>
              Saldo atual: {money(archiving.balance)}.{' '}
              {needsExplicitConfirm(archiving.balance) ? (
                <>
                  Transfira o saldo antes ou confirme que quer arquivar mesmo assim.
                  <label className="mt-2 flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={(e) => setForce(e.target.checked)}
                    />
                    Arquivar mesmo com saldo
                  </label>
                </>
              ) : (
                'A conta sai das listas e do total, e continua nos extratos antigos.'
              )}
              {archiveError !== null && (
                <span role="alert" className="mt-2 block text-negative">
                  {archiveError}
                </span>
              )}
            </>
          }
          cancelLabel="Cancelar"
          confirmLabel="Arquivar"
          pending={needsExplicitConfirm(archiving.balance) && !force}
          onCancel={() => setArchiving(null)}
          onConfirm={() => {
            void setAccountArchived(archiving.account.id, true, newAttemptKey())
              .then(() => {
                setArchiving(null);
                setReload((n) => n + 1);
              })
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
    </div>
  );
};
