import { useState } from 'react';

import { Modal } from '../../components/overlay.js';
import { FormShell } from '../../views/entry/form_shell.js';
import { Field, Input, MoneyInput, Select } from '../../views/entry/fields.js';
import { draftOfCard, emptyCardDraft, validateCard } from '../domain/card_ops.js';
import type { CardDraft } from '../domain/card_ops.js';
import type { Card, FinanceData } from '../domain/types.js';

/** FIN-503 · O modal de cartão, para criar e para editar. */
export const CardDialog = ({
  data,
  card,
  onSave,
  onClose,
}: {
  readonly data: FinanceData;
  readonly card?: Card | undefined;
  readonly onSave: (draft: CardDraft) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const payers = data.accounts.filter((a) => a.type === 'conta' && a.archived !== true);
  const [draft, setDraft] = useState<CardDraft>(() =>
    card === undefined ? emptyCardDraft(payers[0]?.id ?? '') : draftOfCard(card),
  );
  const [attempted, setAttempted] = useState(false);
  const errors = validateCard(data, draft, card?.id);
  const shown = (field: keyof typeof errors): string | undefined =>
    attempted ? errors[field] : undefined;
  const set = (patch: Partial<CardDraft>): void => setDraft({ ...draft, ...patch });

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
      title={card === undefined ? 'Novo cartão' : 'Editar cartão'}
      subtitle="Todo cartão pertence a uma conta"
      onClose={onClose}
    >
      <FormShell
        pending={false}
        onSave={save}
        onCancel={onClose}
        saveLabel={card === undefined ? 'Criar cartão' : 'Salvar'}
      >
        <div className="grid grid-cols-[1fr_8rem] gap-4">
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
          <Field label="Final" error={shown('last4')}>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                maxLength={4}
                invalid={shown('last4') !== undefined}
                value={draft.last4}
                onChange={(event) => set({ last4: event.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label="Conta que paga a fatura" error={shown('payerId')}>
          {(props) => (
            <Select
              {...props}
              invalid={shown('payerId') !== undefined}
              options={payers.map((a) => ({ id: a.id, name: a.name }))}
              value={draft.payerId}
              onChange={(event) => set({ payerId: event.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Limite" error={shown('limit')}>
            {(props) => (
              <MoneyInput
                {...props}
                invalid={shown('limit') !== undefined}
                value={draft.limit}
                onChange={(event) => set({ limit: event.target.value })}
              />
            )}
          </Field>
          <Field label="Dia de fechamento" error={shown('closingDay')}>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                invalid={shown('closingDay') !== undefined}
                value={draft.closingDay}
                onChange={(event) => set({ closingDay: event.target.value })}
              />
            )}
          </Field>
          <Field label="Dia de vencimento" error={shown('dueDay')}>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                invalid={shown('dueDay') !== undefined}
                value={draft.dueDay}
                onChange={(event) => set({ dueDay: event.target.value })}
              />
            )}
          </Field>
        </div>
      </FormShell>
    </Modal>
  );
};
