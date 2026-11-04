import { useState } from 'react';
import { Navigate, useParams } from 'react-router';

import { Button } from '../../components/primitives.js';
import { AccountDialog } from '../components/account_dialog.js';
import { Amount } from '../components/amount.js';
import { BalanceChart } from '../components/balance_chart.js';
import { PeriodControl } from '../components/period_control.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { ScreenHeader } from '../components/screen_header.js';
import { NatureTag } from '../components/tags.js';
import { StatementTable } from '../components/statement_table.js';
import { TransferDialog } from '../components/transfer_dialog.js';
import { updateAccount } from '../domain/account_ops.js';
import {
  accountSubtitle,
  dailyBalances,
  findAccount,
  statement,
  statementCloses,
} from '../domain/accounts.js';
import { addTransfer } from '../domain/transfer_ops.js';
import type { Account } from '../domain/types.js';
import { formatDay } from '../lib/format.js';
import { financeRoutes } from '../lib/routes.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';

/**
 * FIN-405 a FIN-408 · Extrato de uma conta ou benefício.
 *
 * Mostra como o saldo se formou no período: saldo de abertura, o que entrou, o
 * que saiu e o saldo atual, mais o gráfico dia a dia e a tabela com o saldo após
 * cada movimentação. Conta e benefício usam a mesma tela.
 */
export const StatementScreen = (): React.ReactElement => {
  const { id = '' } = useParams();
  const data = useFinanceData();
  const account = findAccount(data, id);
  if (account === undefined) return <Navigate to={financeRoutes.accounts()} replace />;
  return <Statement account={account} />;
};

const Statement = ({ account }: { readonly account: Account }): React.ReactElement => {
  const data = useFinanceData();
  const store = useFinanceStore();
  const { range, setRange, today } = useFinancePeriod();
  const [dialog, setDialog] = useState<'edit' | 'transfer' | null>(null);

  const stmt = statement(data, account.id, range, today);
  const closes = statementCloses(stmt);
  const balances = dailyBalances(data, account.id, range, today);
  const reachesToday = range.to >= today;
  const roleTag = account.roleTag ?? account.role.toLowerCase();

  return (
    <>
      <ScreenHeader
        title={account.name}
        subtitle={accountSubtitle(account)}
        crumbs={[
          { label: 'Contas', to: financeRoutes.accounts() },
          { label: account.name },
        ]}
        period={<PeriodControl value={range} onChange={setRange} today={today} />}
      />

      <section
        aria-label={`Saldo de ${account.name}`}
        className="rounded-panel border border-line bg-panel shadow-panel"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[1.0625rem] font-semibold">{account.name}</h2>
            {roleTag === '' ? null : <NatureTag kind={roleTag} />}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setDialog('edit')}>Editar</Button>
            {account.type === 'conta' && account.archived !== true ? (
              <Button onClick={() => setDialog('transfer')}>Transferir</Button>
            ) : null}
          </div>
        </header>

        {closes ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-5">
            <span
              className="text-[2.125rem] leading-none font-semibold"
              aria-label={reachesToday ? 'Saldo atual' : 'Saldo no fim do período'}
            >
              <Amount cents={stmt.closing} />
            </span>
            <p className="tabular text-[0.8125rem] text-ink-3">
              saldo de {formatDay(range.from, today)}: <Amount cents={stmt.opening} /> ·
              entrou <Amount cents={stmt.entered} /> · saiu <Amount cents={stmt.left} />
            </p>
          </div>
        ) : (
          <p role="alert" className="px-5 py-5 text-[0.8125rem] text-negative">
            Erro de consistência: o saldo inicial mais as entradas menos as saídas não
            fecha com o saldo atual. Os números desta conta não são exibidos.
          </p>
        )}

        {closes ? (
          <BalanceChart points={balances} today={today} name={account.name} />
        ) : null}
      </section>

      <StatementTable
        data={data}
        account={account}
        statement={stmt}
        range={range}
        today={today}
      />

      {dialog === 'edit' ? (
        <AccountDialog
          data={data}
          account={account}
          onClose={() => setDialog(null)}
          onSave={(draft) => {
            store.set((current) => updateAccount(current, account.id, draft, today));
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'transfer' ? (
        <TransferDialog
          data={data}
          today={today}
          fromId={account.id}
          onClose={() => setDialog(null)}
          onSave={(draft) => {
            store.set((current) => addTransfer(current, draft, today));
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );
};
