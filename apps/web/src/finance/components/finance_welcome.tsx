import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '../../components/primitives.js';
import { addAccount } from '../domain/account_ops.js';
import { addCard } from '../domain/card_ops.js';
import { addEntry, emptyEntryDraft } from '../domain/entry_ops.js';
import type { FinanceData } from '../domain/types.js';
import { financeRoutes } from '../lib/routes.js';
import { useFinanceStore } from '../store/finance_store.js';
import { AccountDialog } from './account_dialog.js';
import { CardDialog } from './card_dialog.js';
import { EntryDialog } from './entry_dialog.js';

/**
 * Prancha 06 A · Visão geral sem dados.
 *
 * Sem conta, cartão ou lançamento não há o que resumir: a tela troca os blocos
 * por um roteiro de três passos, como a de Investimentos. Assim que existe um
 * lançamento, os blocos normais voltam, mesmo com pouca informação.
 */
export const FinanceWelcome = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: string;
}): React.ReactElement => {
  const store = useFinanceStore();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'account' | 'card' | 'entry' | null>(null);
  const hasAccount = data.accounts.length > 0;
  const close = (): void => setDialog(null);

  return (
    <>
      <section className="rounded-panel border border-line bg-panel p-7 shadow-panel">
        <p className="tabular text-label font-medium tracking-[0.06em] text-ink-3 uppercase">
          Finanças
        </p>
        <h2 className="mt-1 text-[1.5rem] leading-8 font-semibold">
          Suas finanças aparecem aqui depois do primeiro lançamento
        </h2>
        <p className="mt-1 text-[0.8125rem] text-ink-2">
          Três passos; nenhum gráfico ou tabela vazio é mostrado antes disso.
        </p>
        <ol className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Step
            n={1}
            title="Crie uma conta"
            text="Dê um nome: conta corrente, carteira, poupança. O saldo inicial vira o ponto de partida."
          >
            <Button variant="primary" onClick={() => setDialog('account')}>
              Criar conta
            </Button>
          </Step>
          <Step
            n={2}
            title="Cadastre um cartão"
            text="Limite, fechamento e vencimento. As compras parceladas entram nas faturas sozinhas."
          >
            <Button
              disabled={!hasAccount}
              title={hasAccount ? undefined : 'Crie uma conta para pagar a fatura'}
              onClick={() => setDialog('card')}
            >
              Novo cartão
            </Button>
          </Step>
          <Step
            n={3}
            title="Lance o que entrou e saiu"
            text="Uma receita ou despesa, com categoria e conta, já basta para começar."
          >
            <Button
              disabled={!hasAccount}
              title={hasAccount ? undefined : 'Crie uma conta primeiro'}
              onClick={() => setDialog('entry')}
            >
              Novo lançamento
            </Button>
          </Step>
        </ol>
      </section>
      <p className="text-[0.8125rem] text-ink-2">
        A tela troca os blocos por um roteiro. Assim que existe um lançamento, os blocos
        normais aparecem, mesmo com pouca informação.
      </p>

      {dialog === 'account' ? (
        <AccountDialog
          data={data}
          onClose={close}
          onSave={(draft) => {
            store.set((current) => addAccount(current, draft, today));
            close();
          }}
        />
      ) : null}
      {dialog === 'card' ? (
        <CardDialog
          data={data}
          onClose={close}
          onSave={(draft) => {
            store.set((current) => addCard(current, draft));
            close();
          }}
        />
      ) : null}
      {dialog === 'entry' ? (
        <EntryDialog
          mode="new"
          data={data}
          today={today}
          initial={emptyEntryDraft(today)}
          onClose={close}
          onCreateRecurring={() => navigate(financeRoutes.recurrings())}
          onSave={(draft) => {
            store.set((current) => addEntry(current, draft, today));
            close();
          }}
        />
      ) : null}
    </>
  );
};

const Step = ({
  n,
  title,
  text,
  children,
}: {
  readonly n: number;
  readonly title: string;
  readonly text: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <li className="flex flex-col items-start gap-1.5 rounded-panel border border-line p-5">
    <span
      aria-hidden="true"
      className={`tabular grid size-6 place-items-center rounded-full text-xs font-semibold ${
        n === 1 ? 'bg-accent text-btn-ink' : 'bg-panel-2 text-ink-2'
      }`}
    >
      {n}
    </span>
    <h3 className="mt-1 text-[0.9375rem] font-semibold">{title}</h3>
    <p className="flex-1 text-[0.8125rem] text-ink-2">{text}</p>
    {children}
  </li>
);
