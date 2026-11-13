import { useState } from 'react';

import { createCard, updateCard } from '../../api/card_write.js';
import { ApiError } from '../../api/client.js';
import { Modal } from '../../components/overlay.js';
import { newAttemptKey } from '../../lib/entry.js';
import { newCardDraft, toCardRequest, validateCard } from '../../lib/card_form.js';
import type { CardDraft } from '../../lib/card_form.js';
import { Field, Input, Select } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';

/**
 * CRT-08 · Novo cartão e editar cartão. Alterar o fechamento vale só para
 * compras futuras: as compras já gravadas mantêm o mês de fatura com que
 * nasceram.
 */
export const CardModal = ({
  editing,
  accounts,
  existingNames,
  onSaved,
  onClose,
}: {
  readonly editing?: { readonly id: string; readonly draft: CardDraft } | undefined;
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly existingNames: readonly string[];
  readonly onSaved: () => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<CardDraft>(
    editing?.draft ?? newCardDraft(accounts[0]?.id ?? ''),
  );
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const errors = validateCard(draft, existingNames);
  const shown = attempted ? errors : {};
  const set = <K extends keyof CardDraft>(key: K, value: CardDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (): Promise<void> => {
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    setFailure(null);
    try {
      const body = toCardRequest(draft);
      if (editing === undefined) await createCard(body, newAttemptKey());
      else await updateCard(editing.id, body, newAttemptKey());
      onSaved();
      onClose();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      guard
      narrow
      title={editing === undefined ? 'Novo cartão' : 'Editar cartão'}
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={failure}
        saveLabel={editing === undefined ? 'Criar cartão' : 'Salvar'}
        onSave={() => void submit()}
        onCancel={onClose}
      >
        <Field label="Nome" error={shown.name}>
          {(p) => (
            <Input
              {...p}
              invalid={p['aria-invalid']}
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
            />
          )}
        </Field>
        <Field label="Final (4 dígitos)" error={shown.last4}>
          {(p) => (
            <Input
              {...p}
              invalid={p['aria-invalid']}
              inputMode="numeric"
              maxLength={4}
              value={draft.last4}
              onChange={(e) => set('last4', e.target.value)}
            />
          )}
        </Field>
        <Field label="Limite" error={shown.limit}>
          {(p) => (
            <Input
              {...p}
              numeric
              inputMode="decimal"
              invalid={p['aria-invalid']}
              value={draft.limit}
              onChange={(e) => set('limit', e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Dia de fechamento"
          error={shown.closingDay}
          hint="Vale só para compras futuras; as já feitas mantêm a fatura."
        >
          {(p) => (
            <Input
              {...p}
              numeric
              inputMode="numeric"
              invalid={p['aria-invalid']}
              value={draft.closingDay}
              onChange={(e) => set('closingDay', e.target.value)}
            />
          )}
        </Field>
        <Field label="Dia de vencimento" error={shown.dueDay}>
          {(p) => (
            <Input
              {...p}
              numeric
              inputMode="numeric"
              invalid={p['aria-invalid']}
              value={draft.dueDay}
              onChange={(e) => set('dueDay', e.target.value)}
            />
          )}
        </Field>
        <Field label="Conta que paga a fatura" error={shown.payAccountId}>
          {(p) => (
            <Select
              {...p}
              invalid={p['aria-invalid']}
              placeholder="Escolha a conta"
              options={accounts}
              value={draft.payAccountId}
              onChange={(e) => set('payAccountId', e.target.value)}
            />
          )}
        </Field>
      </FormShell>
    </Modal>
  );
};
