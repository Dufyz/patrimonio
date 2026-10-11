import { useCallback, useId, useMemo, useState } from 'react';

import { Icon } from '../../components/icon.js';
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
      <label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': hasNote ? noteId : undefined,
        'aria-invalid': error !== undefined,
      })}
      {error !== undefined ? (
        <p id={noteId} className="text-[0.71875rem] text-negative">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={noteId} className="text-[0.71875rem] text-ink-3">
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
    'h-[38px] w-full min-w-0 rounded-control border px-2.5 text-sm font-normal outline-none',
    'focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-ink-3',
    options.invalid
      ? 'border-negative bg-negative-soft'
      : options.changed === true
        ? 'border-attention bg-attention-soft'
        : 'border-line-2 bg-panel',
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
  <span className="relative block">
    <select
      className={`${controlClass({ invalid, changed })} cursor-pointer appearance-none pr-8`}
      {...rest}
    >
      {placeholder === undefined ? null : <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-0 right-2.5 flex h-[38px] items-center text-ink-2"
    >
      <Icon name="chevron-down" />
    </span>
  </span>
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

/**
 * Aviso dentro do modal — o `note` da prancha 13: 12,5 px, fundo da cor do tom e
 * texto na cor normal, com o ícone à frente.
 */
export const Callout = ({
  tone,
  children,
}: {
  readonly tone: 'info' | 'warning' | 'error';
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <div
    role={tone === 'error' ? 'alert' : 'note'}
    className={`flex items-start gap-2.5 rounded-control px-3 py-2.5 text-[0.78125rem] leading-[18px] text-ink ${
      tone === 'warning'
        ? 'bg-attention-soft'
        : tone === 'error'
          ? 'bg-negative-soft'
          : 'bg-accent-soft'
    }`}
  >
    <span
      aria-hidden="true"
      className={`mt-px ${
        tone === 'warning'
          ? 'text-attention'
          : tone === 'error'
            ? 'text-negative'
            : 'text-accent'
      }`}
    >
      <Icon name={tone === 'info' ? 'info' : 'warning'} />
    </span>
    <div className="min-w-0">{children}</div>
  </div>
);
