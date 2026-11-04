import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Button, IconButton } from '../../components/primitives.js';
import { Checkbox } from '../../components/ui/checkbox.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { Amount } from '../components/amount.js';
import {
  FinTable,
  Row,
  SectionRow,
  SummaryRow,
  Td,
  Th,
  THead,
} from '../components/fin_table.js';
import { ArchiveAccountDialog } from '../components/archive_dialog.js';
import { AccountDialog } from '../components/account_dialog.js';
import { TransferDialog } from '../components/transfer_dialog.js';
import { RecentMovements } from '../components/recent_movements.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { ScreenHeader } from '../components/screen_header.js';
import { NatureTag } from '../components/tags.js';
import {
  addAccount,
  archiveAccount,
  restoreAccount,
  updateAccount,
} from '../domain/account_ops.js';
import { accountsOverview } from '../domain/accounts.js';
import type { AccountRow } from '../domain/accounts.js';
import type { Account } from '../domain/types.js';
import { addTransfer } from '../domain/transfer_ops.js';
import { hideBelow } from '../lib/responsive.js';
import { PRIMARY_LABELS } from '../lib/header.js';
import { currentMonth } from '../lib/period.js';
import { financeRoutes } from '../lib/routes.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';

/**
 * FIN-401 · Contas.
 *
 * Onde o dinheiro está: contas (que somam em "Em contas", RN-30) e benefícios
 * (que ficam de fora). A variação é a do mês corrente; no benefício a coluna
 * mostra o crédito mensal, que não é variação (RN-36).
 */

const formatFullDate = (iso: string): string => {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};

export const AccountsScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const { today } = useFinancePeriod();
  const store = useFinanceStore();
  const [showArchived, setShowArchived] = useState(false);
  const overview = accountsOverview(data, currentMonth(today), today, showArchived);
  const hasArchived = data.accounts.some((account) => account.archived === true);
  const [transfer, setTransfer] = useState<{ readonly fromId: string } | null>(null);
  const [archiving, setArchiving] = useState<Account | null>(null);
  const [editing, setEditing] = useState<
    { readonly type: 'new' } | { readonly type: 'edit'; readonly account: Account } | null
  >(null);

  return (
    <>
      <ScreenHeader
        title="Contas"
        extra={<Button onClick={() => setTransfer({ fromId: '' })}>Transferir</Button>}
        primary={{
          label: PRIMARY_LABELS.accounts,
          onClick: () => setEditing({ type: 'new' }),
        }}
        subtitle={
          <>
            Em contas <Amount cents={overview.totalBalance} className="font-sans" /> ·{' '}
            <Amount
              cents={overview.totalVariation}
              variant="signed"
              className="font-sans"
            />{' '}
            no mês · saldos de {formatFullDate(today)}
          </>
        }
      />

      <section className="rounded-panel border border-line bg-panel">
        {hasArchived ? (
          <div className="flex justify-end border-b border-line px-4 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink-2">
              <Checkbox
                checked={showArchived}
                onCheckedChange={(value) => setShowArchived(value === true)}
              />
              Mostrar arquivadas
            </label>
          </div>
        ) : null}
        <FinTable caption="Contas e benefícios">
          <THead>
            <Th>Conta</Th>
            <Th className={hideBelow(1)}>Cartão</Th>
            <Th align="right">Saldo</Th>
            <Th align="right" className={hideBelow(2)}>
              Variação no mês
            </Th>
            <Th>
              <span className="sr-only">Ações</span>
            </Th>
          </THead>
          <tbody>
            <SectionRow colSpan={5} label="Contas" summary="entram no saldo em contas" />
            {overview.accounts.map((row) => (
              <AccountTableRow
                key={row.account.id}
                row={row}
                onTransfer={() => setTransfer({ fromId: row.account.id })}
                onEdit={() => setEditing({ type: 'edit', account: row.account })}
                onArchive={() => setArchiving(row.account)}
                onRestore={() =>
                  store.set((current) => restoreAccount(current, row.account.id))
                }
              />
            ))}
            <SummaryRow kind="total">
              <Td>Total em contas</Td>
              <Td className={hideBelow(1)} />
              <Td numeric>
                <Amount cents={overview.totalBalance} />
              </Td>
              <Td numeric className={hideBelow(2)}>
                <Amount cents={overview.totalVariation} variant="delta" />
              </Td>
              <Td />
            </SummaryRow>
            <SectionRow
              colSpan={5}
              label="Benefícios"
              summary="ficam fora do saldo em contas"
            />
            {overview.benefits.map((row) => (
              <AccountTableRow
                key={row.account.id}
                row={row}
                onTransfer={() => setTransfer({ fromId: row.account.id })}
                onEdit={() => setEditing({ type: 'edit', account: row.account })}
                onArchive={() => setArchiving(row.account)}
                onRestore={() =>
                  store.set((current) => restoreAccount(current, row.account.id))
                }
              />
            ))}
          </tbody>
        </FinTable>
      </section>

      <RecentMovements />

      {editing === null ? null : (
        <AccountDialog
          data={data}
          account={editing.type === 'edit' ? editing.account : undefined}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            store.set((current) =>
              editing.type === 'edit'
                ? updateAccount(current, editing.account.id, draft, today)
                : addAccount(current, draft, today),
            );
            setEditing(null);
          }}
        />
      )}

      {archiving === null ? null : (
        <ArchiveAccountDialog
          data={data}
          account={archiving}
          today={today}
          onClose={() => setArchiving(null)}
          onTransfer={() => {
            setTransfer({ fromId: archiving.id });
            setArchiving(null);
          }}
          onConfirm={(confirmedBalance) => {
            store.set((current) =>
              archiveAccount(current, archiving.id, today, confirmedBalance),
            );
            setArchiving(null);
          }}
        />
      )}

      {transfer === null ? null : (
        <TransferDialog
          data={data}
          today={today}
          fromId={transfer.fromId}
          onClose={() => setTransfer(null)}
          onSave={(draft) => {
            store.set((current) => addTransfer(current, draft, today));
            setTransfer(null);
          }}
        />
      )}
    </>
  );
};

const creditLabel = (day: number | undefined): string =>
  day === undefined ? '' : `todo dia ${String(day).padStart(2, '0')}`;

const AccountTableRow = ({
  row,
  onTransfer,
  onEdit,
  onArchive,
  onRestore,
}: {
  readonly row: AccountRow;
  readonly onTransfer: () => void;
  readonly onEdit: () => void;
  readonly onArchive: () => void;
  readonly onRestore: () => void;
}): React.ReactElement => {
  const navigate = useNavigate();
  const { account } = row;
  const isBenefit = account.type === 'beneficio';

  return (
    <Row
      muted={account.archived === true}
      label={account.name}
      onClick={() => void navigate(financeRoutes.account(account.id))}
    >
      <Td>
        <div className="font-medium">
          {account.name}
          {account.archived === true ? (
            <span className="ml-2 align-middle">
              <NatureTag kind="arquivada" />
            </span>
          ) : null}
        </div>
        <div className="text-xs text-ink-3">{account.role}</div>
      </Td>
      <Td className={hideBelow(1)}>
        {row.cards.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.cards.map((card) => (
              <NatureTag key={card} kind={card} />
            ))}
          </span>
        )}
      </Td>
      <Td numeric className="font-medium">
        <Amount cents={row.balance} />
      </Td>
      <Td numeric className={hideBelow(2)}>
        {isBenefit ? (
          <>
            <Amount cents={account.creditCents ?? 0} />{' '}
            <span className="text-xs text-ink-3">{creditLabel(account.creditDay)}</span>
          </>
        ) : (
          <Amount cents={row.variation} variant="delta" />
        )}
      </Td>
      <Td align="right" className="w-12">
        <span
          className="inline-flex"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <RowMenu
            name={account.name}
            canTransfer={!isBenefit && account.archived !== true}
            archived={account.archived === true}
            onTransfer={onTransfer}
            onEdit={onEdit}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        </span>
      </Td>
    </Row>
  );
};

/** O `⋯` da linha. Arquivada, a conta oferece Reativar (FIN-409). */
const RowMenu = ({
  name,
  canTransfer,
  archived,
  onTransfer,
  onEdit,
  onArchive,
  onRestore,
}: {
  readonly name: string;
  readonly canTransfer: boolean;
  readonly archived: boolean;
  readonly onArchive: () => void;
  readonly onRestore: () => void;
  readonly onTransfer: () => void;
  readonly onEdit: () => void;
}): React.ReactElement => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <IconButton row label={`Ações de ${name}`} icon="dots" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-40">
      <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
      <DropdownMenuItem disabled={!canTransfer} onSelect={onTransfer}>
        Transferir
      </DropdownMenuItem>
      {archived ? (
        <DropdownMenuItem onSelect={onRestore}>Reativar</DropdownMenuItem>
      ) : (
        <DropdownMenuItem onSelect={onArchive}>Arquivar</DropdownMenuItem>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
);
