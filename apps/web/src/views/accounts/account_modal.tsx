import { useState } from 'react';

import { createAccount, updateAccount } from '../../api/account_write.js';
import { ApiError } from '../../api/client.js';
import { Modal } from '../../components/overlay.js';
import { newAttemptKey } from '../../lib/entry.js';
import {
  ACCOUNT_TYPES,
  newAccountDraft,
  toAccountRequest,
  validateAccount,
} from '../../lib/account_form.js';
import type { AccountDraft } from '../../lib/account_form.js';
import { Field, Input, Select } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';

/**
 * CTA-05 · Nova conta e editar conta. "No patrimônio" vem ligado; desligar
 * tira a conta de Em contas e do Patrimônio, mas ela segue em Contas e Extrato.
 */
export const AccountModal = ({
  today,
  editing,
  existingNames,
  onSaved,
  onClose,
}: {
  readonly today: string;
  readonly editing?: { readonly id: string; readonly draft: AccountDraft } | undefined;
  /** Os nomes das outras contas, para o nome único. */
  readonly existingNames: readonly string[];
  readonly onSaved: () => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<AccountDraft>(
    editing?.draft ?? newAccountDraft(today),
  );
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const errors = validateAccount(draft, existingNames);
  const shown = attempted ? errors : {};
  const set = <K extends keyof AccountDraft>(key: K, value: AccountDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (): Promise<void> => {
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    setFailure(null);
    try {
      const body = toAccountRequest(draft);
      if (editing === undefined) await createAccount(body, newAttemptKey());
      else await updateAccount(editing.id, body, newAttemptKey());
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
      title={editing === undefined ? 'Nova conta' : 'Editar conta'}
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={failure}
        saveLabel={editing === undefined ? 'Criar conta' : 'Salvar'}
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
        <Field label="Papel da conta">
          {(p) => (
            <Input
              {...p}
              invalid={false}
              placeholder="Ex.: reserva de emergência"
              value={draft.role}
              onChange={(e) => set('role', e.target.value)}
            />
          )}
        </Field>
        <Field label="Tipo">
          {(p) => (
            <Select
              {...p}
              invalid={false}
              options={ACCOUNT_TYPES}
              value={draft.type}
              onChange={(e) => set('type', e.target.value as AccountDraft['type'])}
            />
          )}
        </Field>
        <Field label="Instituição">
          {(p) => (
            <Input
              {...p}
              invalid={false}
              value={draft.institution}
              onChange={(e) => set('institution', e.target.value)}
            />
          )}
        </Field>
        <Field label="Saldo de abertura" error={shown.openingAmount}>
          {(p) => (
            <Input
              {...p}
              numeric
              invalid={p['aria-invalid']}
              inputMode="decimal"
              value={draft.openingAmount}
              onChange={(e) => set('openingAmount', e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Data de abertura"
          error={shown.openingDate}
          hint="Movimentações anteriores a esta data não entram no saldo."
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              invalid={p['aria-invalid']}
              value={draft.openingDate}
              onChange={(e) => set('openingDate', e.target.value)}
            />
          )}
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.inWealth}
            onChange={(e) => set('inWealth', e.target.checked)}
          />
          No patrimônio
        </label>
      </FormShell>
    </Modal>
  );
};
