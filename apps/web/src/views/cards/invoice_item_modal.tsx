import { useState } from 'react';

import { addCardItem } from '../../api/invoice_write.js';
import { ApiError } from '../../api/client.js';
import type { CategoryOption } from '../../api/ledger_write.js';
import { Modal } from '../../components/overlay.js';
import { newAttemptKey } from '../../lib/entry.js';
import {
  CHARGE_SUBTYPES,
  CREDIT_SUBTYPES,
  itemRequest,
  validateItem,
} from '../../lib/invoice_actions.js';
import type { ItemDraft } from '../../lib/invoice_actions.js';
import { Field, Input, Select } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';

/**
 * CRT-07 · Crédito (devolução, estorno, desconto, cashback) e encargo (juros,
 * multa, IOF, anuidade). O crédito reduz o total e abate a despesa da categoria;
 * o encargo pede categoria de despesa e soma ao total. `initial` pré-preenche o
 * estorno com o valor e a categoria da compra.
 */
export const InvoiceItemModal = ({
  cardId,
  kind,
  month,
  months,
  categories,
  initial,
  reversesId,
  onSaved,
  onClose,
}: {
  readonly cardId: string;
  readonly kind: 'credito' | 'encargo';
  readonly month: string;
  /** As faturas sem pagamento, onde o item pode cair. */
  readonly months: readonly string[];
  readonly categories: readonly CategoryOption[];
  readonly initial?: Partial<ItemDraft> | undefined;
  readonly reversesId?: string | undefined;
  readonly onSaved: () => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const subtypes = kind === 'credito' ? CREDIT_SUBTYPES : CHARGE_SUBTYPES;
  const [draft, setDraft] = useState<ItemDraft>({
    kind,
    subtype: subtypes[0].id,
    description: '',
    amount: '',
    categoryId: '',
    month,
    ...initial,
  });
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const errors = validateItem(draft);
  const shown = attempted ? errors : {};
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (): Promise<void> => {
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    setFailure(null);
    try {
      await addCardItem(
        cardId,
        {
          ...itemRequest(draft),
          ...(reversesId === undefined ? {} : { reverses_id: reversesId }),
        },
        newAttemptKey(),
      );
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
      title={kind === 'credito' ? 'Novo crédito na fatura' : 'Novo encargo na fatura'}
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={failure}
        saveLabel={kind === 'credito' ? 'Lançar crédito' : 'Lançar encargo'}
        onSave={() => void submit()}
        onCancel={onClose}
      >
        <Field label="Tipo">
          {(p) => (
            <Select
              {...p}
              invalid={false}
              options={subtypes}
              value={draft.subtype}
              onChange={(e) => set('subtype', e.target.value as ItemDraft['subtype'])}
            />
          )}
        </Field>
        <Field label="Descrição" error={shown.description}>
          {(p) => (
            <Input
              {...p}
              invalid={p['aria-invalid']}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>
        <Field label="Valor" error={shown.amount}>
          {(p) => (
            <Input
              {...p}
              numeric
              inputMode="decimal"
              invalid={p['aria-invalid']}
              value={draft.amount}
              onChange={(e) => set('amount', e.target.value)}
            />
          )}
        </Field>
        {kind === 'encargo' && (
          <Field label="Categoria" error={shown.categoryId}>
            {(p) => (
              <Select
                {...p}
                invalid={p['aria-invalid']}
                placeholder="Escolha a categoria"
                options={categories
                  .filter((c) => c.kind === 'despesa')
                  .map((c) => ({ id: c.id, name: c.name }))}
                value={draft.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label="Fatura" hint="Só faturas sem pagamento recebem lançamentos.">
          {(p) => (
            <Select
              {...p}
              invalid={false}
              options={months.map((m) => ({ id: m, name: m }))}
              value={draft.month}
              onChange={(e) => set('month', e.target.value)}
            />
          )}
        </Field>
      </FormShell>
    </Modal>
  );
};
