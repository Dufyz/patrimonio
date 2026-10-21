import { cn } from '../lib/cn.js';
import { colorForToken } from '../lib/tokens.js';
import { Icon } from './icon.js';
import type { IconName } from './icon.js';
import { UiButton } from './ui/button.js';
import type { ButtonVariants } from './ui/button.js';

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
    className={cn(
      'min-w-0 overflow-hidden rounded-panel border border-line bg-panel shadow-panel',
      className,
    )}
  >
    {title === undefined && action === undefined ? null : (
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          {title === undefined ? null : (
            <h2 className="truncate text-panel-title font-semibold">{title}</h2>
          )}
          {hint === undefined ? null : (
            <span className="truncate text-xs text-ink-3">{hint}</span>
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
    className={cn(
      'tabular text-label font-normal tracking-[0.08em] text-ink-3 uppercase',
      className,
    )}
  >
    {children}
  </span>
);

/**
 * A etiqueta de atalho da prancha 03: mono 10,5 em peso 500, só contorno — sem
 * preenchimento — e raio 4. Dentro de botão cheio ela herda a cor do texto, com
 * 70% de opacidade, que é como a prancha desenha o `N` do botão Lançamento.
 */
export const Kbd = ({
  children,
  onFilled = false,
  className,
}: {
  readonly children: string;
  /** Sobre um botão cheio (primário, perigo): contorno e texto na cor do botão. */
  readonly onFilled?: boolean;
  readonly className?: string | undefined;
}): React.ReactElement => (
  <kbd
    className={cn(
      'tabular rounded-sm border px-[5px] py-px text-[0.65625rem] leading-[1.2] font-medium',
      onFilled ? 'border-current opacity-70' : 'border-line-2 text-ink-3',
      className,
    )}
  >
    {children}
  </kbd>
);

export type ButtonProps = Omit<React.ComponentProps<'button'>, 'type'> &
  ButtonVariants & {
    readonly shortcut?: string | undefined;
    readonly icon?: IconName | undefined;
    readonly type?: 'button' | 'submit' | 'reset';
  };

export const Button = ({
  variant = 'secondary',
  shortcut,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): React.ReactElement => (
  <UiButton type={type} variant={variant} className={className} {...rest}>
    {icon === undefined ? null : <Icon name={icon} />}
    {children}
    {shortcut === undefined ? null : (
      <Kbd onFilled={variant === 'primary' || variant === 'danger'}>{shortcut}</Kbd>
    )}
  </UiButton>
);

export const IconButton = ({
  label,
  icon,
  row = false,
  className,
  children,
  ...rest
}: Omit<React.ComponentProps<'button'>, 'type'> & {
  readonly label: string;
  /**
   * O botão de ícone de dentro de uma linha (o lápis de editar, o `···`): em
   * repouso é só o ícone, e a moldura aparece no mouse — como na prancha 05.
   */
  readonly row?: boolean;
  /** O ícone da prancha; `children` cobre o caso raro de um conteúdo próprio. */
  readonly icon?: IconName | undefined;
}): React.ReactElement => (
  <UiButton
    type="button"
    aria-label={label}
    title={label}
    variant={row ? 'ghost' : 'secondary'}
    size="icon"
    className={cn(
      row &&
        'size-7 text-ink-2 hover:border-line-2 hover:bg-panel focus-visible:border-line-2',
      className,
    )}
    {...rest}
  >
    {icon === undefined ? null : <Icon name={icon} />}
    {children}
  </UiButton>
);

/**
 * O campo de busca padrão: a caixa de controle da prancha 03 com a lupa à
 * frente. Toda busca da aplicação passa por aqui — o ícone é sempre o mesmo e
 * sempre na mesma posição. `inline` é a versão sem caixa, para o topo de uma
 * lista que abre sobre a tela (seletor com busca).
 */
export const SearchInput = ({
  value,
  onChange,
  label,
  placeholder,
  inline = false,
  className,
  inputClassName,
  ...rest
}: Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'placeholder' | 'size'
> & {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly placeholder: string;
  readonly inline?: boolean;
  readonly inputClassName?: string | undefined;
}): React.ReactElement => (
  <label
    className={cn(
      'flex h-control cursor-text items-center gap-2 text-ink-3',
      inline
        ? 'border-b border-line px-3'
        : 'rounded-control border border-line-2 bg-panel px-[11px] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft',
      className,
    )}
  >
    <Icon name="search" />
    <input
      type="search"
      value={value}
      aria-label={label}
      placeholder={placeholder}
      autoComplete="off"
      className={cn(
        'min-w-0 flex-1 bg-transparent text-[0.8125rem] font-normal text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden',
        inputClassName,
      )}
      onChange={(event) => onChange(event.target.value)}
      {...rest}
    />
  </label>
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
    className="inline-flex h-control items-stretch self-start overflow-hidden rounded-control border border-line-2 bg-panel"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={option.value === value}
        {...(option.title === undefined ? {} : { title: option.title })}
        className={`tabular cursor-pointer border-r border-line-2 px-[11px] text-xs font-medium whitespace-nowrap last:border-r-0 ${
          option.value === value
            ? 'bg-seg-active text-seg-active-ink'
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

  const shape = `inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[0.78125rem] font-medium whitespace-nowrap ${
    selected
      ? 'border-accent bg-accent-soft text-accent'
      : 'border-line-2 bg-panel text-ink'
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
        className="inline-flex cursor-pointer items-center text-ink-3 hover:text-ink"
        onClick={onRemove}
      >
        <Icon name="close" size={12} />
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
