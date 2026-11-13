import { useState } from 'react';

import { setAccountArchived, updateAccount } from '../../api/account_write.js';
import { fetchAccounts } from '../../api/accounts.js';
import type { AccountRowResource } from '../../api/accounts.js';
import { ApiError } from '../../api/client.js';
import { setCardArchived } from '../../api/card_write.js';
import { fetchCardsOverview } from '../../api/cards_overview.js';
import type { CardRowResource } from '../../api/cards_overview.js';
import { usePreferences } from '../../components/preferences.js';
import { Button } from '../../components/primitives.js';
import { formatMoney } from '../../lib/format.js';
import { newAttemptKey } from '../../lib/entry.js';
import { toAccountRequest } from '../../lib/account_form.js';
import { useResource } from '../../lib/use_resource.js';
import { AccountModal } from '../accounts/account_modal.js';
import { CardModal } from '../cards/card_modal.js';
import {
  EditButton,
  Muted,
  ROW,
  SettingsPanel,
  SettingsSection,
  StatusDot,
  Switch,
  TD,
  TH,
  TH_RIGHT,
} from './parts.js';

/**
 * CFG-03 · Contas e cartões num lugar só: duas tabelas de cadastro. Criar,
 * editar, arquivar e reativar reaproveitam os modais e as regras de Contas e de
 * Cartões; a marca "no patrimônio" se alterna na própria linha, e o servidor
 * recusa o arquivamento que as regras proíbem. Alterar o cadastro relê as duas
 * leituras, e as telas de Contas e Cartões leem de novo ao abrir.
 */
const TYPE_LABEL: Readonly<Record<string, string>> = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  carteira: 'Carteira / dinheiro',
};

const asDate = (iso: string): string =>
  `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export const AccountsCardsSection = (): React.ReactElement => {
  const { hidden } = usePreferences();
  const accounts = useResource((signal) => fetchAccounts(true, signal), []);
  const cards = useResource((signal) => fetchCardsOverview(signal), []);
  const [accountModal, setAccountModal] = useState<{
    readonly row: AccountRowResource | null;
  } | null>(null);
  const [cardModal, setCardModal] = useState<{
    readonly row: CardRowResource | null;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const money = (value: string): string => formatMoney(value, { hidden }).text;
  const reload = (): void => {
    accounts.reload();
    cards.reload();
  };
  const attempt = async (action: () => Promise<unknown>): Promise<void> => {
    setFailure(null);
    try {
      await action();
      reload();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
    }
  };

  const accountRows =
    accounts.state.kind === 'ready' ? accounts.state.value.accounts : [];
  const cardRows = cards.state.kind === 'ready' ? cards.state.value.cards : [];
  const activeAccounts = accountRows.filter((row) => !row.account.archived);
  const accountName = (id: string): string =>
    accountRows.find((row) => row.account.id === id)?.account.name ?? '—';

  const toggleWealth = (row: AccountRowResource): Promise<unknown> =>
    updateAccount(
      row.account.id,
      toAccountRequest({
        name: row.account.name,
        role: row.account.role,
        type: row.account.type as 'corrente' | 'poupanca' | 'carteira',
        institution: row.account.institution ?? '',
        openingAmount: row.account.opening_amount.replace('.', ','),
        openingDate: row.account.opening_date,
        inWealth: !row.account.in_wealth,
      }),
      newAttemptKey(),
    );

  return (
    <>
      <SettingsSection
        id="contas-e-cartoes"
        title="Contas e cartões"
        description="O cadastro de onde o dinheiro está e de como você paga. Arquivar tira da lista de escolha e mantém o histórico."
      >
        {failure === null ? null : (
          <p
            role="alert"
            className="rounded-panel border border-negative/40 bg-panel px-4 py-2 text-[0.8125rem] text-negative"
          >
            {failure}
          </p>
        )}

        <SettingsPanel
          title="Contas"
          action={
            <Button icon="plus" onClick={() => setAccountModal({ row: null })}>
              Nova conta
            </Button>
          }
        >
          {accounts.state.kind === 'loading' ? (
            <p className="p-4 text-[0.8125rem] text-ink-3">Carregando as contas…</p>
          ) : accounts.state.kind === 'error' ? (
            <p role="alert" className="p-4 text-[0.8125rem] text-negative">
              Não foi possível carregar as contas.{' '}
              <button
                type="button"
                className="cursor-pointer underline"
                onClick={accounts.reload}
              >
                Tentar novamente
              </button>
            </p>
          ) : accountRows.length === 0 ? (
            <p className="p-4 text-[0.8125rem] text-ink-3">Nenhuma conta cadastrada.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[0.8125rem] whitespace-nowrap">
                <caption className="sr-only">Contas cadastradas</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Conta
                    </th>
                    <th scope="col" className={TH}>
                      Tipo
                    </th>
                    <th scope="col" className={TH}>
                      Instituição
                    </th>
                    <th scope="col" className={TH_RIGHT}>
                      Saldo de abertura
                    </th>
                    <th scope="col" className={TH_RIGHT}>
                      Data de abertura
                    </th>
                    <th scope="col" className={TH}>
                      No patrimônio
                    </th>
                    <th scope="col" className={TH}>
                      Situação
                    </th>
                    <th scope="col" className="w-40" />
                  </tr>
                </thead>
                <tbody>
                  {accountRows.map((row) => (
                    <tr key={row.account.id} className={ROW}>
                      <th scope="row" className={`${TD} text-left font-medium`}>
                        {row.account.name}
                      </th>
                      <td className={TD}>
                        {TYPE_LABEL[row.account.type] ?? row.account.type}
                      </td>
                      <td className={TD}>
                        {row.account.institution ?? <Muted>—</Muted>}
                      </td>
                      <td className={`${TD} tabular text-right`}>
                        {money(row.account.opening_amount)}
                      </td>
                      <td className={`${TD} tabular text-right`}>
                        {asDate(row.account.opening_date)}
                      </td>
                      <td className={TD}>
                        <Switch
                          checked={row.account.in_wealth}
                          label={`No patrimônio: ${row.account.name}`}
                          onChange={() => void attempt(() => toggleWealth(row))}
                        />
                      </td>
                      <td className={TD}>
                        <StatusDot tone={row.account.archived ? 'neutral' : 'ok'}>
                          {row.account.archived ? 'Arquivada' : 'Ativa'}
                        </StatusDot>
                      </td>
                      <td className="pr-4 text-right whitespace-nowrap">
                        <EditButton
                          label={`a conta ${row.account.name}`}
                          onClick={() => setAccountModal({ row })}
                        />{' '}
                        <button
                          type="button"
                          className="cursor-pointer text-xs underline"
                          onClick={() =>
                            void attempt(() =>
                              setAccountArchived(
                                row.account.id,
                                !row.account.archived,
                                newAttemptKey(),
                              ),
                            )
                          }
                        >
                          {row.account.archived ? 'Reativar' : 'Arquivar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingsPanel>

        <SettingsPanel
          title="Cartões"
          action={
            <Button
              icon="plus"
              disabled={activeAccounts.length === 0}
              title={
                activeAccounts.length === 0
                  ? 'Cadastre uma conta pagadora antes.'
                  : undefined
              }
              onClick={() => setCardModal({ row: null })}
            >
              Novo cartão
            </Button>
          }
        >
          {cards.state.kind === 'loading' ? (
            <p className="p-4 text-[0.8125rem] text-ink-3">Carregando os cartões…</p>
          ) : cards.state.kind === 'error' ? (
            <p role="alert" className="p-4 text-[0.8125rem] text-negative">
              Não foi possível carregar os cartões.{' '}
              <button
                type="button"
                className="cursor-pointer underline"
                onClick={cards.reload}
              >
                Tentar novamente
              </button>
            </p>
          ) : cardRows.length === 0 ? (
            <p className="p-4 text-[0.8125rem] text-ink-3">Nenhum cartão cadastrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[0.8125rem] whitespace-nowrap">
                <caption className="sr-only">Cartões cadastrados</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      Cartão
                    </th>
                    <th scope="col" className={TH}>
                      Final
                    </th>
                    <th scope="col" className={TH_RIGHT}>
                      Limite
                    </th>
                    <th scope="col" className={TH_RIGHT}>
                      Fechamento
                    </th>
                    <th scope="col" className={TH_RIGHT}>
                      Vencimento
                    </th>
                    <th scope="col" className={TH}>
                      Conta pagadora
                    </th>
                    <th scope="col" className={TH}>
                      Situação
                    </th>
                    <th scope="col" className="w-40" />
                  </tr>
                </thead>
                <tbody>
                  {cardRows.map((row) => (
                    <tr key={row.card.id} className={ROW}>
                      <th scope="row" className={`${TD} text-left font-medium`}>
                        {row.card.name}
                      </th>
                      <td className={`${TD} tabular`}>{row.card.last4 || '—'}</td>
                      <td className={`${TD} tabular text-right`}>
                        {money(row.card.limit_amount)}
                      </td>
                      <td className={`${TD} tabular text-right`}>
                        dia {row.card.closing_day}
                      </td>
                      <td className={`${TD} tabular text-right`}>
                        dia {row.card.due_day}
                      </td>
                      <td className={TD}>{accountName(row.card.pay_account_id)}</td>
                      <td className={TD}>
                        <StatusDot tone="ok">Ativo</StatusDot>
                      </td>
                      <td className="pr-4 text-right whitespace-nowrap">
                        <EditButton
                          label={`o cartão ${row.card.name}`}
                          onClick={() => setCardModal({ row })}
                        />{' '}
                        <button
                          type="button"
                          className="cursor-pointer text-xs underline"
                          onClick={() =>
                            void attempt(() =>
                              setCardArchived(row.card.id, true, newAttemptKey()),
                            )
                          }
                        >
                          Arquivar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingsPanel>
      </SettingsSection>

      {accountModal === null ? null : (
        <AccountModal
          today={
            accounts.state.kind === 'ready'
              ? accounts.state.value.as_of
              : new Date().toISOString().slice(0, 10)
          }
          editing={
            accountModal.row === null
              ? undefined
              : {
                  id: accountModal.row.account.id,
                  draft: {
                    name: accountModal.row.account.name,
                    role: accountModal.row.account.role,
                    type: accountModal.row.account.type as
                      'corrente' | 'poupanca' | 'carteira',
                    institution: accountModal.row.account.institution ?? '',
                    openingAmount: accountModal.row.account.opening_amount.replace(
                      '.',
                      ',',
                    ),
                    openingDate: accountModal.row.account.opening_date,
                    inWealth: accountModal.row.account.in_wealth,
                  },
                }
          }
          existingNames={accountRows
            .filter((row) => row.account.id !== accountModal.row?.account.id)
            .map((row) => row.account.name)}
          onSaved={reload}
          onClose={() => setAccountModal(null)}
        />
      )}
      {cardModal === null ? null : (
        <CardModal
          editing={
            cardModal.row === null
              ? undefined
              : {
                  id: cardModal.row.card.id,
                  draft: {
                    name: cardModal.row.card.name,
                    last4: cardModal.row.card.last4,
                    limit: cardModal.row.card.limit_amount.replace('.', ','),
                    closingDay: String(cardModal.row.card.closing_day),
                    dueDay: String(cardModal.row.card.due_day),
                    payAccountId: cardModal.row.card.pay_account_id,
                  },
                }
          }
          accounts={activeAccounts.map((row) => ({
            id: row.account.id,
            name: row.account.name,
          }))}
          existingNames={cardRows
            .filter((row) => row.card.id !== cardModal.row?.card.id)
            .map((row) => row.card.name)}
          onSaved={reload}
          onClose={() => setCardModal(null)}
        />
      )}
    </>
  );
};
