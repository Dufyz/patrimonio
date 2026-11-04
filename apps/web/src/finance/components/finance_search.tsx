import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { searchFinance } from '../domain/search.js';
import type { SearchItem } from '../domain/search.js';
import { useFinanceData } from '../store/finance_store.js';
import { useFinancePeriod } from './period_provider.js';

/**
 * FIN-703 · A busca global (⌘K) de Finanças. Resultados agrupados; seta anda,
 * Enter abre, Esc fecha. Abrir um lançamento leva a Lançamentos com a busca
 * aplicada.
 */
export const FinanceSearch = ({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): React.ReactElement | null => {
  const data = useFinanceData();
  const { today } = useFinancePeriod();
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const groups = useMemo(() => searchFinance(data, query, today), [data, query, today]);
  const flat: readonly SearchItem[] = groups.flatMap((group) => group.items);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);

  const choose = (item: SearchItem | undefined): void => {
    if (item === undefined) return;
    onClose();
    void navigate(item.to);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(flat.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(flat[active]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-xl self-start" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Buscar em Finanças</DialogTitle>
        <DialogDescription className="sr-only">
          Lançamentos, contas, cartões, recorrentes e categorias
        </DialogDescription>
        <input
          autoFocus
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            flat[active] === undefined ? undefined : `${listId}-${active}`
          }
          aria-label="Buscar"
          placeholder="Buscar lançamento, conta, cartão, recorrente ou categoria"
          className="w-full border-b border-line bg-transparent px-5 py-4 text-[0.9375rem] outline-none placeholder:text-ink-3"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div
          id={listId}
          role="listbox"
          aria-label="Resultados"
          className="max-h-96 overflow-y-auto py-1"
        >
          {query.trim() === '' ? (
            <p className="px-5 py-6 text-[0.8125rem] text-ink-3">Digite para buscar.</p>
          ) : flat.length === 0 ? (
            <p className="px-5 py-6 text-[0.8125rem] text-ink-3">
              Nada encontrado para “{query}”.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.id} role="group" aria-label={group.title}>
                <div className="px-5 pt-3 pb-1 text-label tracking-[0.08em] text-ink-3 uppercase">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const index = flat.indexOf(item);
                  return (
                    <div
                      key={`${item.group}-${item.id}`}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(item)}
                      className={`flex cursor-pointer items-baseline justify-between gap-4 px-5 py-2 text-[0.8125rem] ${
                        index === active ? 'bg-accent-soft' : ''
                      }`}
                    >
                      <span className="truncate font-medium">{item.label}</span>
                      <span className="tabular shrink-0 text-xs text-ink-3">
                        {item.hint}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
