import type { BookRowResource } from '@patrimonio/contracts';
import { useEffect, useState } from 'react';

import { deleteBookRow, fetchCategoryOptions, putFinanceEntry } from '../../api/book.js';
import type { CategoryOption } from '../../api/book.js';
import { AlertModal } from '../../components/overlay.js';
import { formatMoney } from '../../lib/format.js';
import {
  batchTotal,
  canDelete,
  canMove,
  deletePath,
  isEntryRow,
  moveBody,
  recategorizeBody,
} from '../../lib/ledger_batch.js';
import { batchOnlyDelete } from '../../lib/ledger_book.js';

type Action = 'delete' | 'recategorize' | 'move' | null;

const ONLY_DELETE = 'Aporte, resgate, provento e evento só aceitam Excluir.';

/**
 * LAN-08 · A barra de lote: contagem, Recategorizar, Mover de conta e Excluir,
 * com confirmação que traz a contagem e o valor total afetado.
 */
export const BatchActions = ({
  chosen,
  accounts,
  hidden,
  onDone,
  onClear,
}: {
  readonly chosen: readonly BookRowResource[];
  readonly accounts: ReadonlyMap<string, string>;
  readonly hidden: boolean;
  /** Depois de agir: a tela relê o livro. */
  readonly onDone: () => void;
  readonly onClear: () => void;
}): React.ReactElement => {
  const [action, setAction] = useState<Action>(null);
  const [categories, setCategories] = useState<readonly CategoryOption[]>([]);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const onlyDelete = batchOnlyDelete(chosen);
  const entries = chosen.every(isEntryRow);
  const kinds = new Set(chosen.map((row) => row.kind));
  const sameKind = kinds.size === 1;
  const recategorizeBlocked = onlyDelete || !entries || !sameKind;
  const moveBlocked = onlyDelete || !chosen.every(canMove);
  const deleteBlocked = !chosen.every(canDelete);
  const total = formatMoney(batchTotal(chosen), { hidden }).text;
  const count = `${chosen.length} ${chosen.length === 1 ? 'lançamento' : 'lançamentos'}`;

  useEffect(() => {
    if (action !== 'recategorize') return;
    fetchCategoryOptions()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [action]);

  const close = (): void => {
    setAction(null);
    setTarget('');
    setFailure(null);
  };

  const run = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      // Um a um, na ordem: o primeiro erro para o lote e diz o que não foi feito.
      for (const row of chosen) {
        if (action === 'delete') {
          const path = deletePath(row);
          if (path !== null) await deleteBookRow(path);
        } else if (action === 'recategorize') {
          await putFinanceEntry(row.id, recategorizeBody(row, target));
        } else if (action === 'move') {
          await putFinanceEntry(row.id, moveBody(row, target));
        }
      }
      close();
      onClear();
      onDone();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível concluir');
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const kindOfRows = chosen[0]?.kind === 'RECEITA' ? 'receita' : 'despesa';
  const options =
    action === 'recategorize'
      ? categories
          .filter((c) => c.kind === kindOfRows)
          .map((c) => [c.id, c.name] as const)
      : [...accounts].map(([id, name]) => [id, name] as const);

  return (
    <div role="toolbar" aria-label="Ações em lote" className="flex items-center gap-3">
      <span>
        {chosen.length} {chosen.length === 1 ? 'selecionado' : 'selecionados'}
      </span>
      <button
        type="button"
        className="cursor-pointer disabled:cursor-not-allowed"
        disabled={recategorizeBlocked}
        title={
          onlyDelete
            ? ONLY_DELETE
            : recategorizeBlocked
              ? 'Recategorizar vale para despesas ou receitas, um tipo por vez.'
              : undefined
        }
        onClick={() => setAction('recategorize')}
      >
        Recategorizar
      </button>
      <button
        type="button"
        className="cursor-pointer disabled:cursor-not-allowed"
        disabled={moveBlocked}
        title={
          onlyDelete
            ? ONLY_DELETE
            : moveBlocked
              ? 'Só lançamentos pagos em conta podem mudar de conta.'
              : undefined
        }
        onClick={() => setAction('move')}
      >
        Mover de conta
      </button>
      <button
        type="button"
        className="cursor-pointer disabled:cursor-not-allowed"
        disabled={deleteBlocked}
        title={deleteBlocked ? 'Pagamento de fatura sai pela fatura.' : undefined}
        onClick={() => setAction('delete')}
      >
        Excluir
      </button>
      <button type="button" className="cursor-pointer" onClick={onClear}>
        Limpar seleção
      </button>

      <AlertModal
        open={action !== null}
        title={
          action === 'delete'
            ? `Excluir ${count}?`
            : action === 'recategorize'
              ? `Recategorizar ${count}`
              : `Mover ${count} de conta`
        }
        message={
          <span className="flex flex-col gap-3">
            <span>
              {count} · valor total {total}.
              {action === 'delete' ? ' A exclusão não pode ser desfeita em lote.' : ''}
            </span>
            {action === 'delete' ? null : (
              <label className="flex flex-col gap-1">
                {action === 'recategorize' ? 'Nova categoria' : 'Nova conta'}
                <select
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  className="rounded-field border border-line bg-field px-2 py-1.5"
                >
                  <option value="">Escolha…</option>
                  {options.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {failure === null ? null : (
              <span role="alert" className="text-negative">
                {failure}
              </span>
            )}
          </span>
        }
        cancelLabel="Cancelar"
        confirmLabel={
          action === 'delete'
            ? 'Excluir'
            : action === 'recategorize'
              ? 'Recategorizar'
              : 'Mover'
        }
        danger={action === 'delete'}
        pending={busy || (action !== 'delete' && target === '')}
        onCancel={close}
        onConfirm={() => void run()}
      />
    </div>
  );
};
