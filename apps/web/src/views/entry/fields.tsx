import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '../../components/icon.js';
import type { EntryField, FieldErrors } from '../../lib/entry.js';
import { maskMoney } from '../../lib/money_mask.js';

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
        : 'border-line-2 bg-field',
    options.numeric === true ? 'tabular text-right' : '',
  ].join(' ');

export const Input = ({
  invalid,
  changed,
  numeric,
  className,
  ...rest
}: React.ComponentProps<'input'> & {
  readonly invalid: boolean;
  readonly changed?: boolean;
  readonly numeric?: boolean;
}): React.ReactElement => (
  <input
    className={`${controlClass({ invalid, changed, numeric })} ${className ?? ''}`}
    {...rest}
  />
);

/**
 * Campo de dinheiro: o `Input` com a máscara de `maskMoney`. O valor chega a
 * `onChange` já mascarado (`event.target.value`), então quem usa continua
 * guardando uma string e lendo com `parseAmountInput`. `maxDecimals` é 2 para
 * total e taxa, e mais para preço de cota e provento por ação.
 *
 * O cursor é devolvido ao lugar depois de remascarar — sem isso, editar um
 * dígito no meio de `1.234,56` jogaria o cursor para o fim a cada tecla.
 */
export const MoneyInput = ({
  maxDecimals = 2,
  mask = true,
  value,
  onChange,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value'> & {
  readonly invalid: boolean;
  readonly changed?: boolean;
  readonly numeric?: boolean;
  readonly maxDecimals?: number;
  /** Falso devolve o `Input` comum: o mesmo campo que às vezes é quantidade. */
  readonly mask?: boolean;
  readonly value: string;
}): React.ReactElement => {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (caret.current === null || ref.current === null) return;
    ref.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  const shown = mask ? maskMoney(value, maxDecimals) : value;

  const input = (
    <Input
      numeric
      inputMode="decimal"
      autoComplete="off"
      {...rest}
      className={`${mask ? 'pl-9 ' : ''}${className ?? ''}`}
      ref={ref}
      value={shown}
      onChange={(event) => {
        if (mask) {
          const element = event.target;
          const position = element.selectionStart ?? element.value.length;
          const atEnd = position >= element.value.length;
          const significant = element.value
            .slice(0, position)
            .replace(/[^\d,]/g, '').length;

          const masked = maskMoney(element.value, maxDecimals);
          element.value = masked;

          let target = masked.length;
          if (!atEnd) {
            let seen = 0;
            target = 0;
            while (target < masked.length && seen < significant) {
              if (/[\d,]/.test(masked.charAt(target))) seen += 1;
              target += 1;
            }
          }
          caret.current = target;
        }
        onChange?.(event);
      }}
    />
  );

  if (!mask) return input;

  // O "R$" fica fora do valor: o campo guarda `1.200,00`, e a tela mostra
  // `R$ 1.200,00`. Assim o valor continua sendo lido por `parseAmountInput`.
  return (
    <span className="relative block w-full">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-ink-3"
      >
        R$
      </span>
      {input}
    </span>
  );
};

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

/** O rótulo de um grupo de botões ou de um bloco que não é um campo de texto. */
export const FieldLabel = ({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <span className="text-xs font-medium text-ink-2">{children}</span>
);
