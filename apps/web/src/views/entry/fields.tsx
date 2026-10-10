import { useCallback, useId, useMemo, useState } from 'react';

import type { EntryField, FieldErrors } from '../../lib/entry.js';

/**
 * T-10 · As peças de formulário dos modais de lançamento.
 *
 * Três regras valem para todo campo, e estão aqui uma vez só:
 *
 * - **o erro aparece no próprio campo**, ligado a ele por `aria-describedby` —
 *   um erro no rodapé do modal obriga a procurar qual campo ele fala;
 * - **o erro espera a pessoa passar pelo campo**: um formulário vazio que abre
 *   gritando vermelho em todo campo ensina a ignorar vermelho. Depois de uma
 *   tentativa de salvar, todos os erros aparecem;
 * - **o que mudou numa edição fica marcado**, com o valor de antes ao lado.
 */

export type ControlProps = {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': boolean;
};

export const Field = ({
  label,
  error,
  hint,
  className,
  children,
}: {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: React.ReactNode;
  readonly className?: string | undefined;
  readonly children: (props: ControlProps) => React.ReactNode;
}): React.ReactElement => {
  const id = useId();
  const noteId = `${id}-note`;
  const hasNote = error !== undefined || hint !== undefined;

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className="text-[0.8125rem] text-ink-2">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': hasNote ? noteId : undefined,
        'aria-invalid': error !== undefined,
      })}
      {error !== undefined ? (
        <p id={noteId} className="text-[0.75rem] text-negative">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={noteId} className="text-[0.75rem] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
};

const controlClass = (options: {
  readonly invalid: boolean;
  readonly changed?: boolean | undefined;
  readonly numeric?: boolean | undefined;
}): string =>
  [
    'h-control w-full min-w-0 rounded-control border px-3 text-sm outline-none',
    'focus:border-accent disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-ink-3',
    options.invalid
      ? 'border-negative bg-negative-soft'
      : options.changed === true
        ? 'border-attention bg-attention-soft'
        : 'border-line bg-panel',
    options.numeric === true ? 'tabular text-right' : '',
  ].join(' ');

export const Input = ({
  invalid,
  changed,
  numeric,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  readonly invalid: boolean;
  readonly changed?: boolean;
  readonly numeric?: boolean;
}): React.ReactElement => (
  <input
    className={`${controlClass({ invalid, changed, numeric })} ${className ?? ''}`}
    {...rest}
  />
);

export const Select = ({
  invalid,
  changed,
  options,
  placeholder,
  ...rest
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  readonly invalid: boolean;
  readonly changed?: boolean;
  readonly options: readonly { readonly id: string; readonly name: string }[];
  readonly placeholder?: string;
}): React.ReactElement => (
  <select className={controlClass({ invalid, changed })} {...rest}>
    {placeholder === undefined ? null : <option value="">{placeholder}</option>}
    {options.map((option) => (
      <option key={option.id} value={option.id}>
        {option.name}
      </option>
    ))}
  </select>
);

/**
 * Quais erros mostrar agora. O erro de um campo só aparece depois que a pessoa
 * passou por ele (`touch`) ou tentou salvar (`attempt`); o erro que a `api`
 * devolveu — venda acima da posição, por exemplo — aparece na hora, porque a
 * pessoa já viu o resultado do que digitou.
 */
export const useVisibleErrors = (
  errors: FieldErrors,
  fromApi: FieldErrors = {},
): {
  readonly show: (field: EntryField) => string | undefined;
  readonly touch: (field: EntryField) => void;
  readonly attempt: () => void;
  readonly attempted: boolean;
} => {
  const [touched, setTouched] = useState<ReadonlySet<EntryField>>(new Set());
  const [attempted, setAttempted] = useState(false);

  const touch = useCallback(
    (field: EntryField) =>
      setTouched((current) =>
        current.has(field) ? current : new Set(current).add(field),
      ),
    [],
  );
  const attempt = useCallback(() => setAttempted(true), []);

  return useMemo(
    () => ({
      show: (field: EntryField): string | undefined =>
        fromApi[field] ?? (attempted || touched.has(field) ? errors[field] : undefined),
      touch,
      attempt,
      attempted,
    }),
    [errors, fromApi, touched, attempted, touch, attempt],
  );
};

/** Aviso dentro do modal: o que muda, o que a `api` recusou. */
export const Callout = ({
  tone,
  children,
}: {
  readonly tone: 'info' | 'warning' | 'error';
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <div
    role={tone === 'error' ? 'alert' : 'note'}
    className={`rounded-control px-3 py-2 text-[0.8125rem] ${
      tone === 'warning'
        ? 'bg-attention-soft text-attention'
        : tone === 'error'
          ? 'bg-negative-soft text-negative'
          : 'bg-accent-soft text-ink-2'
    }`}
  >
    {children}
  </div>
);
