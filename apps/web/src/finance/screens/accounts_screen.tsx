import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Button, IconButton } from '../../components/primitives.js';
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
import { TransferDialog } from '../components/transfer_dialog.js';
import { RecentMovements } from '../components/recent_movements.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { ScreenHeader } from '../components/screen_header.js';
import { NatureTag } from '../components/tags.js';
import { accountsOverview } from '../domain/accounts.js';
import type { AccountRow } from '../domain/accounts.js';
import { addTransfer } from '../domain/transfer_ops.js';
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
  const overview = accountsOverview(data, currentMonth(today), today);
  const [transfer, setTransfer] = useState<{ readonly fromId: string } | null>(null);

  return (
    <>
      <ScreenHeader
        title="Contas"
        extra={<Button onClick={() => setTransfer({ fromId: '' })}>Transferir</Button>}
        subtitle={
          <>
            Em contas <Amount cents={overview.totalBalance} /> ·{' '}
            <Amount cents={overview.totalVariation} variant="delta" /> no mês · saldos de{' '}
            {formatFullDate(today)}
          </>
        }
      />

      <section className="rounded-panel border border-line bg-panel">
        <FinTable caption="Contas e benefícios">
          <THead>
            <Th>Conta</Th>
            <Th>Cartão</Th>
            <Th align="right">Saldo</Th>
            <Th align="right">Variação no mês</Th>
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
              />
            ))}
            <SummaryRow kind="total">
              <Td>Total em contas</Td>
              <Td />
              <Td numeric>
                <Amount cents={overview.totalBalance} />
              </Td>
              <Td numeric>
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
              />
            ))}
          </tbody>
        </FinTable>
      </section>

      <RecentMovements />

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
}: {
  readonly row: AccountRow;
  readonly onTransfer: () => void;
}): React.ReactElement => {
  const navigate = useNavigate();
  const { account } = row;
  const isBenefit = account.type === 'beneficio';

  return (
    <Row
      label={account.name}
      onClick={() => void navigate(financeRoutes.account(account.id))}
    >
      <Td>
        <div className="font-medium">{account.name}</div>
        <div className="text-xs text-ink-3">{account.role}</div>
      </Td>
      <Td>
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
      <Td numeric>
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
          <RowMenu name={account.name} canTransfer={!isBenefit} onTransfer={onTransfer} />
        </span>
      </Td>
    </Row>
  );
};

/** O `⋯` da linha. Editar entra com FIN-404 e Arquivar com FIN-409. */
const RowMenu = ({
  name,
  canTransfer,
  onTransfer,
}: {
  readonly name: string;
  readonly canTransfer: boolean;
  readonly onTransfer: () => void;
}): React.ReactElement => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <IconButton row label={`Ações de ${name}`} icon="dots" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-40">
      <DropdownMenuItem disabled>Editar</DropdownMenuItem>
      <DropdownMenuItem disabled={!canTransfer} onSelect={onTransfer}>
        Transferir
      </DropdownMenuItem>
      <DropdownMenuItem disabled>Arquivar</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
