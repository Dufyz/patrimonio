import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { setAccountArchived } from '../../api/account_write.js';
import { fetchAccounts } from '../../api/accounts.js';
import { ApiError } from '../../api/client.js';
import type { AccountRowResource, AccountsResource } from '../../api/accounts.js';
import { usePreferences } from '../../components/preferences.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { AlertModal } from '../../components/overlay.js';
import { formatMoney } from '../../lib/format.js';
import { needsExplicitConfirm } from '../../lib/account_form.js';
import { newAttemptKey } from '../../lib/entry.js';
import { NewEntryModal } from '../ledger/new_entry_modal.js';
import { AccountModal } from './account_modal.js';

/**
 * CTA-01 · Contas: onde está o dinheiro. Saldo de hoje, previsto de fim de mês e
 * a linha de total, que soma só as contas com "no patrimônio". Sem sparklines e
 * sem seção de benefícios; arquivadas ficam ocultas até "mostrar arquivadas".
 */
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
        primary={{ label: 'Nova conta', onClick: () => setModal('nova') }}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        Mostrar arquivadas
      </label>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-label text-ink-3 uppercase">
            <th scope="col">Conta</th>
            <th scope="col" className="max-md:hidden">
              Instituição
            </th>
            <th scope="col" className="max-lg:hidden">
              Cartões
            </th>
            <th scope="col">No patrimônio</th>
            <th scope="col" className="text-right">
              Saldo hoje
            </th>
            <th scope="col" className="text-right">
              Previsto em fim de mês
            </th>
            <th scope="col">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.accounts.map((row) => (
            <tr
              key={row.account.id}
              tabIndex={0}
              className="cursor-pointer hover:bg-panel-2"
              onClick={() => navigate(`/contas-novo/${row.account.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigate(`/contas-novo/${row.account.id}`);
              }}
            >
              <th scope="row" className="text-left font-normal">
                {row.account.name}
                <span className="block text-xs text-ink-3">{row.account.role}</span>
              </th>
              <td className="max-md:hidden">{row.account.institution ?? '—'}</td>
              <td className="max-lg:hidden">
                {row.cards.length === 0 ? '—' : row.cards.join(', ')}
              </td>
              <td>{row.account.in_wealth ? '● Sim' : '○ Não'}</td>
              <td className="tabular text-right">{money(row.balance)}</td>
              <td className="tabular text-right">{money(row.projected_month_end)}</td>
              <td
                className="text-right whitespace-nowrap"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="cursor-pointer text-xs underline"
                  onClick={() => setEditing(row)}
                >
                  Editar
                </button>{' '}
                <button
                  type="button"
                  className="cursor-pointer text-xs underline"
                  onClick={() => {
                    setForce(false);
                    setArchiveError(null);
                    if (row.account.archived) {
                      void setAccountArchived(row.account.id, false, newAttemptKey())
                        .then(() => setReload((n) => n + 1))
                        .catch(() => setFailed(true));
                    } else setArchiving(row);
                  }}
                >
                  {row.account.archived ? 'Reativar' : 'Arquivar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr
            tabIndex={0}
            className="cursor-pointer font-semibold hover:bg-panel-2"
            onClick={() => navigate(financeRoutes.entries(`conta=${countedIds}`))}
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                navigate(financeRoutes.entries(`conta=${countedIds}`));
            }}
          >
            <th scope="row" colSpan={3} className="text-left">
              Total em contas
            </th>
            <td />
            <td className="tabular text-right">{money(data.total_balance)}</td>
            <td className="tabular text-right">{money(data.projected_total)}</td>
          </tr>
        </tfoot>
      </table>
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
