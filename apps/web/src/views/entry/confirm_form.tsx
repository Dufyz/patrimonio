import type { TransactionResource } from '@patrimonio/contracts';
import { useEffect, useMemo, useState } from 'react';

import { confirmPayout, dismissPayout, fetchTransaction } from '../../api/entry.js';
import type { SaveReceipt } from '../../api/entry.js';
import { Money } from '../../components/number.js';
import { Button } from '../../components/primitives.js';
import { PAYOUT_KIND_LABELS } from '../../lib/asset_page.js';
import { buildConfirmBody, inputValue, isPendingPayout } from '../../lib/entry.js';
import { formatShortDate } from '../../lib/positions.js';
import { Callout, Field, Input, useVisibleErrors } from './fields.js';
import { FormShell } from './form_shell.js';
import { useSave } from './hooks.js';

/**
 * T-10 · Confirmar recebimento (prancha 17D).
 *
 * O provento previsto vira recebido. O campo abre com o líquido esperado, e
 * quem recebeu diferente digita o valor real: a `api` guarda o previsto ao lado
 * do recebido, e a diferença aparece em vez de sumir na edição.
 *
 * "Não foi pago" é outra decisão, não um cancelamento: o provento sai do livro e
 * o motivo fica registrado. Por isso pede o motivo, e não uma confirmação vazia.
 */

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly transaction: TransactionResource };

export const ConfirmEntry = ({
  transactionId,
  assetLabel,
  onSaved,
  onCancel,
}: {
  readonly transactionId: string;
  readonly assetLabel?: string | undefined;
  readonly onSaved: (receipt: SaveReceipt) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ status: 'loading' });

    fetchTransaction(transactionId, controller.signal)
      .then((transaction) => {
        if (!controller.signal.aborted) setLoaded({ status: 'ready', transaction });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'A api não respondeu',
        });
      });

    return () => controller.abort();
  }, [transactionId]);

  if (loaded.status === 'loading') {
    return <p className="py-6 text-center text-sm text-ink-3">Carregando o provento…</p>;
  }

  if (loaded.status === 'error' || !isPendingPayout(loaded.transaction)) {
    return (
      <div className="flex flex-col gap-3">
        <Callout tone={loaded.status === 'error' ? 'error' : 'info'}>
          {loaded.status === 'error'
            ? loaded.message
            : 'Este provento já foi confirmado.'}
        </Callout>
        <div className="flex justify-end">
          <Button onClick={onCancel}>Fechar</Button>
        </div>
      </div>
    );
  }

  return (
    <ConfirmFormView
      transaction={loaded.transaction}
      assetLabel={assetLabel}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
};

export const ConfirmFormView = ({
  transaction,
  assetLabel,
  onSaved,
  onCancel,
}: {
  readonly transaction: TransactionResource;
  readonly assetLabel?: string | undefined;
  readonly onSaved: (receipt: SaveReceipt) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const expected = transaction.expected_net_amount ?? transaction.net_amount;
  const [netAmount, setNetAmount] = useState(inputValue(expected));
  const [note, setNote] = useState('');
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);

  const built = useMemo(() => buildConfirmBody({ netAmount, note }), [netAmount, note]);
  const errors = built.ok ? {} : built.errors;
  const visible = useVisibleErrors(errors);
  const save = useSave();

  const submit = async (): Promise<void> => {
    if (dismissing) {
      if (reason.trim() === '') {
        setReasonMissing(true);
        return;
      }
      const receipt = await save.run((key) =>
        dismissPayout(transaction.id, { reason: reason.trim() }, key),
      );
      if (receipt !== null) onSaved(receipt);
      return;
    }

    visible.attempt();
    if (!built.ok) return;

    const receipt = await save.run((key) =>
      confirmPayout(transaction.id, built.body, key),
    );
    if (receipt !== null) onSaved(receipt);
  };

  const kind =
    transaction.payout_kind === null
      ? 'Provento'
      : (PAYOUT_KIND_LABELS[transaction.payout_kind] ?? 'Provento');

  return (
    <FormShell
      pending={save.pending}
      saveLabel={dismissing ? 'Registrar que não foi pago' : 'Confirmar recebimento'}
      onSave={() => void submit()}
      onCancel={onCancel}
      error={save.error}
      secondary={
        <Button onClick={() => setDismissing((current) => !current)}>
          {dismissing ? 'Voltar' : 'Não foi pago'}
        </Button>
      }
    >
      <p className="text-sm">
        <strong className="font-semibold">
          {kind}
          {assetLabel === undefined ? '' : ` · ${assetLabel}`}
        </strong>
        <span className="ml-2 text-ink-3">
          pagamento previsto em {formatShortDate(transaction.settlement_date)}
        </span>
      </p>

      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-2">Líquido esperado</span>
        <Money value={expected} />
      </div>

      {dismissing ? (
        <Field
          label="Motivo"
          error={reasonMissing && reason.trim() === '' ? 'Informe o motivo.' : undefined}
          hint="Fica registrado; o provento sai do livro."
        >
          {(control) => (
            <Input
              {...control}
              autoFocus
              invalid={control['aria-invalid']}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      ) : (
        <>
          <Field
            label="Líquido recebido"
            error={visible.show('netAmount')}
            hint="Se chegou um valor diferente do esperado, digite o que caiu na conta."
          >
            {(control) => (
              <Input
                {...control}
                numeric
                autoFocus
                inputMode="decimal"
                invalid={control['aria-invalid']}
                value={netAmount}
                onBlur={() => visible.touch('netAmount')}
                onChange={(event) => setNetAmount(event.target.value)}
              />
            )}
          </Field>
          <Field label="Observação">
            {(control) => (
              <Input
                {...control}
                invalid={false}
                placeholder="opcional"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </>
      )}
    </FormShell>
  );
};
