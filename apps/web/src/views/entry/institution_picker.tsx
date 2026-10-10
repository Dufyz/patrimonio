import { useId, useMemo, useRef, useState } from 'react';

import { createInstitution } from '../../api/institutions.js';
import { useDismiss } from '../../components/use_dismiss.js';
import type { ControlProps } from './fields.js';
import { Input } from './fields.js';

/**
 * A instituição do lançamento.
 *
 * O catálogo brasileiro tem centenas de linhas, então a escolha é uma busca, e
 * não uma lista. A estrangeira não está no catálogo: quando o texto não bate
 * com nenhuma, a lista oferece "Criar «X»" e pergunta só o país.
 *
 * Como no ativo, o campo não guarda texto solto: digitar desfaz a escolha, e o
 * formulário só vale de novo quando uma instituição da lista é escolhida.
 */

export type InstitutionOption = { readonly id: string; readonly name: string };

export type CreateInstitution = (body: {
  readonly name: string;
  readonly country: string;
}) => Promise<InstitutionOption>;

const MAX_ITEMS = 50;
const DEFAULT_COUNTRY = 'US';

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

export const InstitutionPicker = ({
  options,
  value,
  onChange,
  onBlur,
  control,
  invalid,
  changed = false,
  create = createInstitution,
}: {
  readonly options: readonly InstitutionOption[];
  readonly value: string | null;
  readonly onChange: (id: string | null) => void;
  readonly onBlur?: () => void;
  readonly control: ControlProps;
  readonly invalid: boolean;
  readonly changed?: boolean;
  /** Troca-se nos testes; a identidade precisa ser estável. */
  readonly create?: CreateInstitution;
}): React.ReactElement => {
  const [created, setCreated] = useState<readonly InstitutionOption[]>([]);
  const all = useMemo(() => [...options, ...created], [options, created]);
  const selected = all.find((option) => option.id === value) ?? null;

  const [query, setQuery] = useState(selected?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const listId = useId();

  useDismiss(container, open, () => {
    setOpen(false);
    setCreating(false);
  });

  const text = query.trim();
  const needle = fold(text);

  const items = useMemo(
    () =>
      all
        .filter((option) => needle === '' || fold(option.name).includes(needle))
        .slice(0, MAX_ITEMS),
    [all, needle],
  );

  const exact = all.some((option) => fold(option.name) === needle);
  const canCreate = text !== '' && !exact;
  const showList = open && value === null;

  const choose = (option: InstitutionOption): void => {
    setQuery(option.name);
    setOpen(false);
    setCreating(false);
    onChange(option.id);
  };

  const confirmCreate = async (): Promise<void> => {
    if (saving) return;
    if (!/^[A-Za-z]{2}$/.test(country)) {
      setFailure('Informe o país com duas letras, como US.');
      return;
    }

    setSaving(true);
    setFailure(null);

    try {
      const institution = await create({ name: text, country: country.toUpperCase() });
      setCreated((current) => [...current, institution]);
      choose(institution);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'A api não respondeu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={container} className="relative">
      <Input
        {...control}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        invalid={invalid}
        changed={changed}
        value={query}
        placeholder="Buscar instituição"
        {...(onBlur === undefined ? {} : { onBlur })}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setCreating(false);
          setActive(0);
          if (value !== null) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((current) => Math.min(current + 1, items.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          } else if (event.key === 'Enter' && showList) {
            const option = items[active];
            event.preventDefault();
            event.stopPropagation();
            if (option !== undefined) choose(option);
          }
        }}
      />

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Instituições encontradas"
          className="absolute top-[calc(var(--spacing-control)+0.25rem)] right-0 left-0 z-30 max-h-64 overflow-y-auto rounded-panel border border-line bg-panel py-1 shadow-lg"
        >
          {items.length === 0 && !canCreate ? (
            <li className="px-3 py-2 text-sm text-ink-3">Nenhuma instituição cadastrada.</li>
          ) : null}

          {items.map((option, index) => (
            <li key={option.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                className={`flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-sm ${
                  index === active ? 'bg-panel-2' : ''
                }`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span className="truncate">{option.name}</span>
              </button>
            </li>
          ))}

          {canCreate ? (
            <li role="presentation" className="border-t border-line">
              {creating ? (
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="text-ink-2">País</span>
                  <input
                    aria-label="País da instituição"
                    value={country}
                    maxLength={2}
                    className="h-control w-14 rounded-control border border-line bg-panel px-2 text-center uppercase"
                    onChange={(event) => setCountry(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        void confirmCreate();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={saving}
                    className="h-control cursor-pointer rounded-control bg-accent px-3 text-sm font-medium text-white disabled:opacity-50"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void confirmCreate()}
                  >
                    Criar
                  </button>
                  {failure === null ? null : (
                    <span role="alert" className="basis-full text-[0.75rem] text-negative">
                      {failure}
                    </span>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full cursor-pointer px-3 py-2 text-left text-sm text-accent hover:bg-panel-2"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setCreating(true);
                    setFailure(null);
                  }}
                >
                  Criar “{text}”
                </button>
              )}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
};
