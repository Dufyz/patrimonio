import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { Icon } from '../../components/icon.js';
import { Kbd, Label } from '../../components/primitives.js';
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
      <DialogContent
        className="max-w-[40rem] gap-0 self-start overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Buscar em Finanças</DialogTitle>
        <DialogDescription className="sr-only">
          Lançamentos, contas, cartões, recorrentes e categorias
        </DialogDescription>
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
          <span aria-hidden="true" className="text-ink">
            <Icon name="search" />
          </span>
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
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[0.9375rem] caret-accent outline-none placeholder:text-ink-3"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="inline-flex min-h-6 items-center rounded-full border border-line-2 px-3 text-[0.71875rem] font-medium">
            Finanças
          </span>
          <Kbd>esc</Kbd>
        </div>
        <div
          id={listId}
          role="listbox"
          aria-label="Resultados"
          className="max-h-96 min-h-0 overflow-y-auto"
        >
          {query.trim() === '' ? (
            <p className="px-4 py-6 text-center text-[0.8125rem] text-ink-3">
              Digite para buscar.
            </p>
          ) : flat.length === 0 ? (
            <p className="px-4 py-6 text-center text-[0.8125rem] text-ink-3">
              Nada encontrado para “{query}”.
            </p>
          ) : (
            groups.map((group) => (
              <div
                key={group.id}
                role="group"
                aria-label={group.title}
                className="flex flex-col gap-1 px-2 py-1.5"
              >
                <div className="px-2.5 pt-1.5 pb-1">
                  <Label>{group.title}</Label>
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
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(item)}
                      className={`flex min-h-[38px] cursor-pointer items-center justify-between gap-3 rounded-[6px] px-2.5 py-2 text-[0.84375rem] ${
                        index === active ? 'bg-accent-soft' : 'bg-panel-2 hover:bg-line'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
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
        <footer className="flex items-center gap-1.5 border-t border-line bg-panel-2 px-4 py-2 text-[0.75rem] text-ink-3">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          navegar ·<Kbd>↵</Kbd>
          abrir
        </footer>
      </DialogContent>
    </Dialog>
  );
};
