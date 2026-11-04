import { useState } from 'react';

import { Modal } from '../../components/overlay.js';
import { FormShell } from '../../views/entry/form_shell.js';
import { Field, Input, MoneyInput, Select } from '../../views/entry/fields.js';
import {
  draftOfAccount,
  emptyAccountDraft,
  validateAccount,
} from '../domain/account_ops.js';
import type { AccountDraft } from '../domain/account_ops.js';
import type { Account, AccountType, FinanceData } from '../domain/types.js';

const TYPES: readonly { readonly id: AccountType; readonly name: string }[] = [
  { id: 'conta', name: 'Conta' },
  { id: 'beneficio', name: 'Benefício' },
];

/**
 * FIN-404 · O modal de conta, para criar e para editar. Benefício pede também o
 * valor e o dia do crédito mensal. O tipo fica travado na edição.
 */
export const AccountDialog = ({
  data,
  account,
  onSave,
  onClose,
}: {
  readonly data: FinanceData;
  /** Ausente em "Nova conta". */
  readonly account?: Account | undefined;
  readonly onSave: (draft: AccountDraft) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<AccountDraft>(() =>
    account === undefined ? emptyAccountDraft() : draftOfAccount(account),
  );
  const [attempted, setAttempted] = useState(false);

  const errors = validateAccount(data, draft, account?.id);
  const shown = (field: keyof typeof errors): string | undefined =>
    attempted ? errors[field] : undefined;
  const set = (patch: Partial<AccountDraft>): void => setDraft({ ...draft, ...patch });

  const save = (): void => {
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    onSave(draft);
  };

  return (
    <Modal
      open
      guard
      narrow
      title={account === undefined ? 'Nova conta' : 'Editar conta'}
      subtitle="Conta corrente, benefício ou carteira"
      onClose={onClose}
    >
      <FormShell
        pending={false}
        onSave={save}
        onCancel={onClose}
        saveLabel={account === undefined ? 'Criar conta' : 'Salvar'}
      >
        <Field label="Nome" error={shown('name')}>
          {(props) => (
            <Input
              {...props}
              autoFocus
              invalid={shown('name') !== undefined}
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          )}
        </Field>
        <Field label="Descrição do papel">
          {(props) => (
            <Input
              {...props}
              invalid={false}
              placeholder="Recebe as receitas e paga as despesas"
              value={draft.role}
              onChange={(event) => set({ role: event.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Tipo"
            hint={account === undefined ? undefined : 'O tipo não muda depois de criada.'}
          >
            {(props) => (
              <Select
                {...props}
                invalid={false}
                disabled={account !== undefined}
                options={TYPES}
                value={draft.type}
                onChange={(event) => set({ type: event.target.value as AccountType })}
              />
            )}
          </Field>
          <Field label="Saldo inicial" error={shown('initial')}>
            {(props) => (
              <MoneyInput
                {...props}
                invalid={shown('initial') !== undefined}
                value={draft.initial}
                onChange={(event) => set({ initial: event.target.value })}
              />
            )}
          </Field>
        </div>
        {draft.type === 'beneficio' ? (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Crédito mensal" error={shown('creditValue')}>
              {(props) => (
                <MoneyInput
                  {...props}
                  invalid={shown('creditValue') !== undefined}
                  value={draft.creditValue}
                  onChange={(event) => set({ creditValue: event.target.value })}
                />
              )}
            </Field>
            <Field label="Dia do crédito" error={shown('creditDay')}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  invalid={shown('creditDay') !== undefined}
                  value={draft.creditDay}
                  onChange={(event) => set({ creditDay: event.target.value })}
                />
              )}
            </Field>
          </div>
        ) : null}
      </FormShell>
    </Modal>
  );
};
