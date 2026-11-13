import type { BookRowResource } from '@patrimonio/contracts';
import { useEffect, useState } from 'react';

import { fetchAccounts } from '../../api/accounts.js';
import { deleteBookRow, fetchCategoryOptions, putFinanceEntry } from '../../api/book.js';
import type { CategoryOption } from '../../api/book.js';
import { EffectTable } from '../../components/effect_table.js';
import { AlertModal } from '../../components/overlay.js';
import { formatMoney } from '../../lib/format.js';
import {
  batchTotal,
  canDelete,
  canMove,
  deleteEffect,
  deletePath,
  isEntryRow,
  moveBody,
  recategorizeBody,
} from '../../lib/ledger_batch.js';
import { batchOnlyDelete } from '../../lib/ledger_book.js';

const ONLY_DELETE = 'Aporte, resgate, provento e evento só aceitam Excluir.';

/**
 * LAN-08 · A barra de lote: contagem, Recategorizar, Mover de conta e Excluir,
 * com confirmação que traz a contagem e o valor total afetado.
 */
export type BatchAction = 'delete' | 'recategorize' | 'move';

/** Diálogo de confirmação reutilizado pela barra de lote e pelo menu da linha. */
export const BatchDialog = ({
  action,
  chosen,
  linked = null,
  accounts,
  hidden,
  onClose,
  onDone,
}: {
  readonly action: BatchAction | null;
  /** RN-U6: o outro lado do resgate que pagou a despesa, se houver. */
  readonly linked?: BookRowResource | null;
  readonly chosen: readonly BookRowResource[];
  readonly accounts: ReadonlyMap<string, string>;
  readonly hidden: boolean;
  readonly onClose: () => void;
  /** Depois de agir (ou falhar): a tela relê o livro. */
  readonly onDone: (ok: boolean) => void;
}): React.ReactElement => {
  const [categories, setCategories] = useState<readonly CategoryOption[]>([]);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [alsoLinked, setAlsoLinked] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [balances, setBalances] = useState<
    ReadonlyMap<string, { readonly name: string; readonly balance: string }>
  >(new Map());
  const total = formatMoney(batchTotal(chosen), { hidden }).text;
  const count = `${chosen.length} ${chosen.length === 1 ? 'lançamento' : 'lançamentos'}`;

  useEffect(() => {
    if (action !== 'recategorize') return;
    fetchCategoryOptions()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [action]);

  // LAN-07.3: o efeito de excluir uma linha só precisa dos saldos de hoje.
  const single = action === 'delete' && chosen.length === 1 ? chosen[0] : undefined;
  useEffect(() => {
    if (single === undefined) return;
    let current = true;
    fetchAccounts(false)
      .then((body) => {
        if (!current) return;
        setBalances(
          new Map(
            body.accounts.map((item) => [
              item.account.id,
              { name: item.account.name, balance: item.balance },
            ]),
          ),
        );
      })
      .catch(() => setBalances(new Map()));
    return () => {
      current = false;
    };
  }, [single]);
  const effect = single === undefined ? [] : deleteEffect(single, balances);

  const close = (): void => {
    setAlsoLinked(true);
    setTarget('');
    setFailure(null);
    onClose();
  };

  const run = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const targets =
        action === 'delete' && linked !== null && alsoLinked
          ? [...chosen, linked]
          : chosen;
      for (const row of targets) {
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
      onDone(true);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível concluir');
      onDone(false);
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
            {action === 'delete' ? ' A exclusão não pode ser desfeita.' : ''}
          </span>
          {action === 'delete' && linked !== null && chosen.length === 1 ? (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={alsoLinked}
                onChange={(event) => setAlsoLinked(event.target.checked)}
              />
              <span>
                Excluir também{' '}
                {linked.kind === 'DESPESA' ? 'a despesa ligada' : 'o resgate ligado'}:{' '}
                {linked.description}
                {linked.amount === null
                  ? ''
                  : ` · ${formatMoney(linked.amount, { hidden }).text}`}
              </span>
            </label>
          ) : null}
          {effect.length > 0 ? <EffectTable rows={effect} /> : null}
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
  );
};

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
  readonly onDone: () => void;
  readonly onClear: () => void;
}): React.ReactElement => {
  const [action, setAction] = useState<BatchAction | null>(null);
  const onlyDelete = batchOnlyDelete(chosen);
  const entries = chosen.every(isEntryRow);
  const sameKind = new Set(chosen.map((row) => row.kind)).size === 1;
  const recategorizeBlocked = onlyDelete || !entries || !sameKind;
  const moveBlocked = onlyDelete || !chosen.every(canMove);
  const deleteBlocked = !chosen.every(canDelete);

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

      <BatchDialog
        action={action}
        chosen={chosen}
        accounts={accounts}
        hidden={hidden}
        onClose={() => setAction(null)}
        onDone={(ok) => {
          if (ok) onClear();
          onDone();
        }}
      />
    </div>
  );
};
