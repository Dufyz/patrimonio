import { useState } from 'react';

import { Modal } from '../../components/overlay.js';
import { Button } from '../../components/primitives.js';
import { Checkbox } from '../../components/ui/checkbox.js';
import { Callout } from '../../views/entry/fields.js';
import { accountBalance } from '../domain/accounts.js';
import { archiveBlockedReason } from '../domain/account_ops.js';
import type { Account, FinanceData } from '../domain/types.js';
import { formatBRL } from '../lib/format.js';

/**
 * FIN-409 · Confirmar o arquivamento. Informa o saldo atual; com saldo diferente
 * de zero, o botão só habilita depois de uma confirmação explícita — ou a pessoa
 * transfere o saldo antes. Conta com cartão ativo não chega a ser arquivada: o
 * modal só explica por quê.
 */
export const ArchiveAccountDialog = ({
  data,
  account,
  today,
  onConfirm,
  onTransfer,
  onClose,
}: {
  readonly data: FinanceData;
  readonly account: Account;
  readonly today: string;
  readonly onConfirm: (confirmedBalance: boolean) => void;
  readonly onTransfer: () => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [confirmed, setConfirmed] = useState(false);
  const balance = accountBalance(data, account.id, today);
  const blocked = archiveBlockedReason(data, account.id);
  const hasBalance = balance !== 0;

  return (
    <Modal
      open
      narrow
      title={`Arquivar ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          {blocked === null && hasBalance && account.type === 'conta' ? (
            <Button onClick={onTransfer}>Transferir saldo</Button>
          ) : null}
          <Button
            variant="primary"
            disabled={blocked !== null || (hasBalance && !confirmed)}
            onClick={() => onConfirm(hasBalance && confirmed)}
          >
            Arquivar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[0.8125rem] text-ink-2">
        <p>
          Saldo atual: <strong className="tabular text-ink">{formatBRL(balance)}</strong>.
          A conta sai de Contas, do total em contas e das opções de origem e destino, e
          continua nos lançamentos e extratos antigos.
        </p>
        {blocked === null ? null : <Callout tone="error">{blocked}</Callout>}
        {blocked === null && hasBalance ? (
          <>
            <Callout tone="warning">
              Esta conta ainda tem saldo. Transfira antes ou confirme que ele fica fora do
              total em contas.
            </Callout>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
              Arquivar mesmo com saldo
            </label>
          </>
        ) : null}
      </div>
    </Modal>
  );
};
