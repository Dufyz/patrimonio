import { useState } from 'react';
import type { BookRowResource } from '@patrimonio/contracts';

import { putFinanceEntry } from '../../api/book.js';
import type { CategoryOption } from '../../api/book.js';
import { isEntryRow, recategorizeBody } from '../../lib/ledger_batch.js';

/**
 * LAN-07 · A célula Categoria: despesa ou receita lançada abre um seletor com as
 * categorias do mesmo tipo, e escolher salva na hora. Os demais tipos só mostram
 * o nome (ou traço).
 */
export const CategoryCell = ({
  row,
  categories,
  onSaved,
}: {
  readonly row: BookRowResource;
  readonly categories: readonly CategoryOption[];
  readonly onSaved: () => void;
}): React.ReactElement => {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = categories.find((c) => c.id === row.category_id)?.name ?? null;
  const editable =
    row.situation === 'lancado' &&
    isEntryRow(row) &&
    (row.kind === 'RECEITA' || row.kind === 'DESPESA');

  if (!editable) return <span className="text-ink-3">{name ?? '—'}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        className="cursor-pointer text-left hover:underline"
        aria-label={`Categoria de ${row.description}: ${name ?? 'sem categoria'}`}
        onClick={() => setEditing(true)}
      >
        {name ?? 'Sem categoria'}
      </button>
    );
  }

  const kind = row.kind === 'RECEITA' ? 'receita' : 'despesa';
  return (
    <span className="flex flex-col gap-1">
      <select
        autoFocus
        aria-label={`Nova categoria de ${row.description}`}
        defaultValue={row.category_id ?? ''}
        className="rounded-field border border-line bg-field px-1 py-0.5"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '') return;
          putFinanceEntry(row.id, recategorizeBody(row, next))
            .then(() => {
              setEditing(false);
              onSaved();
            })
            .catch((cause: unknown) =>
              setError(
                cause instanceof Error ? cause.message : 'Não foi possível salvar',
              ),
            );
        }}
      >
        <option value="">Escolha…</option>
        {categories
          .filter((c) => c.kind === kind)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </select>
      {error === null ? null : (
        <span role="alert" className="text-negative">
          {error}
        </span>
      )}
    </span>
  );
};
