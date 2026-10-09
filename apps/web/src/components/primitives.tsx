import { colorForToken } from '../lib/tokens.js';

/**
 * As peças menores que a prancha 03 define, e que todas as telas repetem.
 *
 * Todas têm a mesma altura — 34 px, o token `--spacing-control` — porque a
 * barra de controles mistura botão, seletor e etiqueta na mesma linha, e um
 * pixel de diferença entre eles é a coisa que mais denuncia interface montada
 * aos pedaços.
 */

export const Panel = ({
  title,
  hint,
  action,
  children,
  className,
}: {
  readonly title?: string | undefined;
  readonly hint?: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string | undefined;
}): React.ReactElement => (
  <section
    className={`overflow-hidden rounded-panel border border-line bg-panel ${className ?? ''}`}
  >
    {title === undefined && action === undefined ? null : (
      <header className="flex h-12 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-baseline gap-2">
          {title === undefined ? null : (
            <h2 className="truncate text-panel-title font-semibold">{title}</h2>
          )}
          {hint === undefined ? null : (
            <span className="truncate text-label text-ink-3">{hint}</span>
          )}
        </div>
        {action}
      </header>
    )}
    {children}
  </section>
);

/** Rótulo em mono caixa alta, como as pranchas usam acima de cada bloco. */
export const Label = ({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string | undefined;
}): React.ReactElement => (
  <span
    className={`tabular text-label tracking-[0.08em] text-ink-3 uppercase ${className ?? ''}`}
  >
    {children}
  </span>
);

export const Kbd = ({ children }: { readonly children: string }): React.ReactElement => (
  <kbd className="tabular rounded-xs border border-line bg-panel-2 px-1 text-[0.6875rem] text-ink-3">
    {children}
  </kbd>
);

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

const BUTTON_CLASS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover border-transparent',
  secondary: 'bg-panel text-ink border-line hover:bg-panel-2',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-panel-2',
  destructive: 'bg-transparent text-negative border-transparent hover:bg-negative-soft',
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly shortcut?: string | undefined;
};

export const Button = ({
  variant = 'secondary',
  shortcut,
  className,
  children,
  ...rest
}: ButtonProps): React.ReactElement => (
  <button
    type="button"
    className={`inline-flex h-control cursor-pointer items-center gap-2 rounded-control border px-3 text-sm whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 ${
      BUTTON_CLASS[variant]
    } ${className ?? ''}`}
    {...rest}
  >
    {children}
    {shortcut === undefined ? null : <Kbd>{shortcut}</Kbd>}
  </button>
);

export const IconButton = ({
  label,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly label: string;
}): React.ReactElement => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={`inline-flex size-control cursor-pointer items-center justify-center rounded-control border border-line bg-panel text-ink-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40 ${
      className ?? ''
    }`}
    {...rest}
  >
    {children}
  </button>
);

export type SegmentedOption<T extends string> = {
  readonly value: T;
  readonly label: React.ReactNode;
  readonly title?: string | undefined;
};

/**
 * O grupo de botões exclusivos: período, agrupamento, densidade. Um `radiogroup`
 * de verdade, para a seta do teclado andar entre as opções sem código extra.
 */
export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  label,
  extra,
}: {
  readonly options: readonly SegmentedOption<T>[];
  /** `null` quando nenhuma opção está ativa — período personalizado, por exemplo. */
  readonly value: T | null;
  readonly onChange: (value: T) => void;
  readonly label: string;
  /** Botão extra no fim do grupo, como o período personalizado da prancha 03. */
  readonly extra?: React.ReactNode;
}): React.ReactElement => (
  <div
    role="radiogroup"
    aria-label={label}
    className="inline-flex h-control items-stretch overflow-hidden rounded-control border border-line bg-panel"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={option.value === value}
        {...(option.title === undefined ? {} : { title: option.title })}
        className={`tabular cursor-pointer border-r border-line px-3 text-[0.8125rem] whitespace-nowrap last:border-r-0 ${
          option.value === value
            ? 'bg-accent-soft font-medium text-accent'
            : 'text-ink-2 hover:bg-panel-2'
        }`}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
    {extra}
  </div>
);

/**
 * Etiqueta de filtro aplicado. Clicar no × remove só aquele filtro; a barra
 * oferece "limpar tudo" à parte, porque remover cinco filtros um a um é o tipo
 * de coisa que faz a pessoa recarregar a página na mão.
 */
export const Chip = ({
  children,
  onRemove,
  colorToken,
  count,
  selected = false,
  onClick,
}: {
  readonly children: React.ReactNode;
  readonly onRemove?: (() => void) | undefined;
  readonly colorToken?: string | undefined;
  readonly count?: number | undefined;
  readonly selected?: boolean;
  readonly onClick?: (() => void) | undefined;
}): React.ReactElement => {
  const content = (
    <>
      {colorToken === undefined ? null : (
        <span
          aria-hidden="true"
          className="size-2 rounded-xs"
          style={{ backgroundColor: colorForToken(colorToken) }}
        />
      )}
      {children}
      {count === undefined ? null : <span className="tabular text-ink-3">{count}</span>}
    </>
  );

  const shape = `inline-flex h-control items-center gap-2 rounded-full border px-3 text-[0.8125rem] whitespace-nowrap ${
    selected
      ? 'border-accent bg-accent-soft text-accent'
      : 'border-line bg-panel text-ink-2'
  }`;

  if (onRemove === undefined) {
    return onClick === undefined ? (
      <span className={shape}>{content}</span>
    ) : (
      <button
        type="button"
        className={`${shape} cursor-pointer hover:bg-panel-2`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={shape}>
      {content}
      <button
        type="button"
        aria-label="Remover filtro"
        className="cursor-pointer text-ink-3 hover:text-ink"
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
};

/**
 * Ponto de saúde do preço, na frente do número. A cor sozinha não basta — a
 * dica diz o mesmo em palavras, e é ela que aparece para quem usa teclado.
 */
export const PriceHealthDot = ({
  kind,
  showFresh = false,
}: {
  readonly kind: 'fresh' | 'stale' | 'manual' | 'missing';
  /**
   * Na tabela, preço atualizado não ganha marca: uma bolinha em toda linha é
   * ruído que some o sinal das poucas linhas que precisam de atenção. Na
   * legenda, ganha — senão a legenda não explica o estado normal.
   */
  readonly showFresh?: boolean;
}): React.ReactElement | null => {
  if (kind === 'fresh' && !showFresh) return null;

  if (kind === 'fresh') {
    return (
      <span
        title="preço atualizado"
        aria-label="preço atualizado"
        role="img"
        className="mr-1 inline-block size-1.5 rounded-full bg-positive align-middle"
      />
    );
  }

  const description =
    kind === 'missing'
      ? 'sem preço · usa o custo'
      : kind === 'manual'
        ? 'preço definido à mão'
        : 'preço atrasado ou de fonte alternativa';

  return (
    <span
      title={description}
      aria-label={description}
      role="img"
      className={`mr-1 inline-block size-1.5 rounded-full align-middle ${
        kind === 'missing'
          ? 'border border-negative'
          : kind === 'manual'
            ? 'bg-accent'
            : 'bg-attention'
      }`}
    />
  );
};
